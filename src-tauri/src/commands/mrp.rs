use crate::models::*;
use crate::db::*;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use chrono::{NaiveDate, Duration, Datelike};
use std::collections::HashMap;

/// Determines if a given date is a working day for a shift based on a 14-day 2-2-3 Panama schedule.
fn is_working_day(target_date: NaiveDate, anchor_date: NaiveDate) -> bool {
    let diff_days = (target_date - anchor_date).num_days();
    let cycle_day = ((diff_days % 14) + 14) % 14;
    let working_days = [0, 1, 4, 5, 6, 9, 10];
    working_days.contains(&cycle_day)
}

/// Helper to get the previous shift in the sequence.
/// Sequence: Shift 1 (Day) -> Shift 2 (Night) -> Shift 1 (Next Day) ...
/// But wait, the user said "Lead times are measured in Transit Shifts".
/// And "Shift 1" vs "Shift 2" was mentioned as an example.
/// In this system, shifts are A, B, C, D.
/// A/B are Day/Night for one pair, C/D are Day/Night for another.
/// Panama schedule:
/// Week 1: A (Day), B (Night) work Mon, Tue, Fri, Sat, Sun.
/// Week 2: A, B work Wed, Thu.
/// C, D work the opposite.
fn get_previous_shift(current_date: NaiveDate, current_shift: &str) -> (NaiveDate, String) {
    // Shifts A/B and C/D are concurrent but on different days.
    // In a 2-shift system per day: Day and Night.
    // A and C are likely Day, B and D are likely Night (or vice-versa).
    // Let's assume: A/C = Day, B/D = Night.
    
    if current_shift == "B" || current_shift == "D" {
        // Current is Night, previous is Day of the same date
        let prev_shift = if current_shift == "B" { "A" } else { "C" };
        (current_date, prev_shift.to_string())
    } else {
        // Current is Day, previous is Night of the previous date
        let prev_date = current_date - Duration::days(1);
        let prev_shift = if current_shift == "A" { "B" } else { "D" };
        (prev_date, prev_shift.to_string())
    }
}

#[tauri::command]
pub async fn generate_cascaded_demand(
    app: AppHandle,
    connection_string: String,
    week_id: String, // e.g., "2026-w17"
) -> Result<(), String> {
    // 1. Load Shift Settings from Tauri Store
    let store = app.get_store("store.json").ok_or("Failed to load store.json")?;
    let shift_settings_val = store.get("shiftSettings").ok_or("shiftSettings not found in store")?;
    let shift_settings: HashMap<String, String> = serde_json::from_value(shift_settings_val)
        .map_err(|e| format!("Failed to parse shiftSettings: {}", e))?;

    let mut anchors = HashMap::new();
    for (shift, date_str) in shift_settings {
        let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
            .map_err(|e| format!("Invalid anchor date for shift {}: {}", shift, e))?;
        anchors.insert(shift, date);
    }

    // 2. Fetch Master Demand from DailyRates
    // week_id "2026-w17" -> Year 2026, Week 17
    let parts: Vec<&str> = week_id.split("-w").collect();
    if parts.len() != 2 {
        return Err("Invalid week_id format. Expected YYYY-wWW".to_string());
    }
    let year: i32 = parts[0].parse().map_err(|_| "Invalid year in week_id")?;
    let week: i32 = parts[1].parse().map_err(|_| "Invalid week in week_id")?;

    let mut client = create_client(&connection_string).await?;
    let rates_stream = client
        .query(
            "SELECT PartNumber, Qty FROM dbo.DailyRate WHERE Week = @p1 AND Year = @p2",
            &[&week, &year],
        )
        .await
        .map_err(|e| e.to_string())?;
    let rates_rows = rates_stream.into_first_result().await.map_err(|e| e.to_string())?;

    // 3. Setup Target Date (Friday of the week as the delivery anchor)
    // To be precise, we should calculate the Friday of the ISO week.
    // Or just use the Monday + 4 days.
    let jan4 = NaiveDate::from_ymd_opt(year, 1, 4).unwrap();
    let day_of_week = jan4.weekday().num_days_from_monday();
    let monday_wk1 = jan4 - Duration::days(day_of_week as i64);
    let target_monday = monday_wk1 + Duration::weeks((week - 1) as i64);
    let delivery_deadline = target_monday + Duration::days(4); // Friday

    // 4. Clear existing UpstreamDemand for this week to avoid duplicates
    // Since we don't have a week column in UpstreamDemand, we'll delete by date range
    let start_date = target_monday;
    let end_date = target_monday + Duration::days(6);
    let start_date_str = start_date.format("%Y-%m-%d").to_string();
    let end_date_str = end_date.format("%Y-%m-%d").to_string();
    client.execute(
        "DELETE FROM dbo.UpstreamDemand WHERE TargetDate BETWEEN @p1 AND @p2",
        &[&start_date_str, &end_date_str],
    ).await.map_err(|e| e.to_string())?;

    // 5. Iterate through each Part and its Routing
    for row in rates_rows {
        let part_number = row.get::<&str, _>("PartNumber").unwrap().trim().to_string();
        let qty = get_i32_robust(&row, "Qty").unwrap_or(0);
        if qty <= 0 { continue; }

        // Fetch Routing for this part
        let routing_stream = client.query(
            "SELECT RoutingID, ProcessName, SequenceNumber, ProcessingTimeMins, BatchSize, TransitShifts 
             FROM dbo.PartRoutings WHERE PartNumber = @p1 ORDER BY SequenceNumber DESC",
            &[&part_number],
        ).await.map_err(|e| e.to_string())?;
        let routing_rows = routing_stream.into_first_result().await.map_err(|e| e.to_string())?;

        let mut current_qty = qty;
        let mut current_date = delivery_deadline;
        let mut current_shift = "A".to_string(); // Start with Day shift on Friday

        for route_row in routing_rows {
            let process_name = route_row.get::<&str, _>("ProcessName").unwrap().trim().to_string();
            let transit_shifts = get_i32_robust(&route_row, "TransitShifts").unwrap_or(0);
            let batch_size = get_i32_robust(&route_row, "BatchSize").unwrap_or(1);

            // Lead Time Offsetting: Count backward by transit_shifts
            let mut shifts_to_offset = transit_shifts;
            while shifts_to_offset > 0 {
                let (prev_date, prev_shift) = get_previous_shift(current_date, &current_shift);
                current_date = prev_date;
                current_shift = prev_shift;

                // Check if this shift is active
                if let Some(anchor) = anchors.get(&current_shift) {
                    if is_working_day(current_date, *anchor) {
                        shifts_to_offset -= 1;
                    }
                } else {
                    // If no anchor, assume it's working (though shouldn't happen)
                    shifts_to_offset -= 1;
                }
            }

            // Batch Math: Round up to nearest multiple of BatchSize
            let batches = (current_qty as f64 / batch_size as f64).ceil() as i32;
            let required_qty = batches * batch_size;

            // Insert into UpstreamDemand
            client.execute(
                "INSERT INTO dbo.UpstreamDemand (PartNumber, ProcessName, TargetDate, TargetShift, RequiredQty)
                 VALUES (@p1, @p2, @p3, @p4, @p5)",
                &[&part_number, &process_name, &current_date.format("%Y-%m-%d").to_string(), &current_shift, &required_qty],
            ).await.map_err(|e| e.to_string())?;

            // The next upstream operation must produce at least this quantity
            current_qty = required_qty;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_upstream_demand(
    connection_string: String,
    process_name: Option<String>,
) -> Result<Vec<UpstreamDemandRow>, String> {
    let mut client = create_client(&connection_string).await?;
    
    let query = if process_name.is_some() {
        format!("SELECT DemandID, PartNumber, ProcessName, CONVERT(VARCHAR, TargetDate, 23) as TargetDate, TargetShift, RequiredQty 
                 FROM dbo.UpstreamDemand WHERE ProcessName = @p1 ORDER BY TargetDate ASC, TargetShift ASC")
    } else {
        format!("SELECT DemandID, PartNumber, ProcessName, CONVERT(VARCHAR, TargetDate, 23) as TargetDate, TargetShift, RequiredQty 
                 FROM dbo.UpstreamDemand ORDER BY TargetDate ASC, TargetShift ASC")
    };

    let params: Vec<&dyn tiberius::ToSql> = match &process_name {
        Some(p) => vec![p],
        None => vec![],
    };

    let stream = client.query(query, &params).await.map_err(|e| e.to_string())?;
    let rows = stream.into_first_result().await.map_err(|e| e.to_string())?;

    let result = rows.into_iter().map(|row| UpstreamDemandRow {
        demand_id: Some(row.get::<i32, _>("DemandID").unwrap()),
        part_number: row.get::<&str, _>("PartNumber").unwrap().trim().to_string(),
        process_name: row.get::<&str, _>("ProcessName").unwrap().trim().to_string(),
        target_date: row.get::<&str, _>("TargetDate").unwrap().trim().to_string(),
        target_shift: row.get::<&str, _>("TargetShift").unwrap().trim().to_string(),
        required_qty: row.get::<i32, _>("RequiredQty").unwrap(),
    }).collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_part_routings(
    connection_string: String,
    part_number: Option<String>,
) -> Result<Vec<PartRouting>, String> {
    let mut client = create_client(&connection_string).await?;
    let query = if part_number.is_some() {
        "SELECT RoutingID, PartNumber, ProcessName, SequenceNumber, ProcessingTimeMins, BatchSize, TransitShifts 
         FROM dbo.PartRoutings WHERE PartNumber = @p1 ORDER BY SequenceNumber ASC"
    } else {
        "SELECT RoutingID, PartNumber, ProcessName, SequenceNumber, ProcessingTimeMins, BatchSize, TransitShifts 
         FROM dbo.PartRoutings ORDER BY PartNumber ASC, SequenceNumber ASC"
    };

    let params: Vec<&dyn tiberius::ToSql> = match &part_number {
        Some(p) => vec![p],
        None => vec![],
    };

    let stream = client.query(query, &params).await.map_err(|e| e.to_string())?;
    let rows = stream.into_first_result().await.map_err(|e| e.to_string())?;

    let result = rows.into_iter().map(|row| PartRouting {
        routing_id: Some(row.get::<i32, _>("RoutingID").unwrap()),
        part_number: row.get::<&str, _>("PartNumber").unwrap().trim().to_string(),
        process_name: row.get::<&str, _>("ProcessName").unwrap().trim().to_string(),
        sequence_number: row.get::<i32, _>("SequenceNumber").unwrap(),
        processing_time_mins: get_f64_robust(&row, "ProcessingTimeMins").unwrap_or(0.0),
        batch_size: get_i32_robust(&row, "BatchSize").unwrap_or(1),
        transit_shifts: get_i32_robust(&row, "TransitShifts").unwrap_or(0),
    }).collect();

    Ok(result)
}

#[tauri::command]
pub async fn upsert_part_routings(
    connection_string: String,
    records: Vec<PartRouting>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        client.execute(
            "MERGE dbo.PartRoutings AS target
             USING (SELECT @p1 as PartNumber, @p2 as SequenceNumber) AS source
             ON (target.PartNumber = source.PartNumber AND target.SequenceNumber = source.SequenceNumber)
             WHEN MATCHED THEN
                UPDATE SET ProcessName = @p3, ProcessingTimeMins = @p4, BatchSize = @p5, TransitShifts = @p6
             WHEN NOT MATCHED THEN
                INSERT (PartNumber, ProcessName, SequenceNumber, ProcessingTimeMins, BatchSize, TransitShifts)
                VALUES (@p1, @p3, @p2, @p4, @p5, @p6);",
            &[&rec.part_number, &rec.sequence_number, &rec.process_name, &rec.processing_time_mins, &rec.batch_size, &rec.transit_shifts],
        ).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_part_routings(
    connection_string: String,
    routing_ids: Vec<i32>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for id in routing_ids {
        client.execute("DELETE FROM dbo.PartRoutings WHERE RoutingID = @p1", &[&id])
            .await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
