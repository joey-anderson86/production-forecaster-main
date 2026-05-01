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
fn get_previous_shift(current_date: NaiveDate, current_shift: &str, anchors: &HashMap<String, NaiveDate>) -> (NaiveDate, String) {
    let is_night = current_shift == "B" || current_shift == "D";
    
    if is_night {
        let target_date = current_date;
        let shift_a_works = anchors.get("A").map(|&a| is_working_day(target_date, a)).unwrap_or(false);
        let shift_c_works = anchors.get("C").map(|&a| is_working_day(target_date, a)).unwrap_or(false);
        
        let prev_shift = if shift_a_works {
            "A"
        } else if shift_c_works {
            "C"
        } else {
            if current_shift == "B" { "A" } else { "C" }
        };
        (target_date, prev_shift.to_string())
    } else {
        let target_date = current_date - Duration::days(1);
        let shift_b_works = anchors.get("B").map(|&a| is_working_day(target_date, a)).unwrap_or(false);
        let shift_d_works = anchors.get("D").map(|&a| is_working_day(target_date, a)).unwrap_or(false);
        
        let prev_shift = if shift_b_works {
            "B"
        } else if shift_d_works {
            "D"
        } else {
            if current_shift == "A" { "B" } else { "D" }
        };
        (target_date, prev_shift.to_string())
    }
}

#[tauri::command]
pub async fn generate_cascaded_demand(
    app: AppHandle,
    connection_string: String,
    week_id: String, // e.g., "2026-w17"
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client.simple_query("BEGIN TRANSACTION").await.map_err(|e| e.to_string())?;

    let result: Result<(), String> = async {
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
        let parts: Vec<&str> = week_id.split("-w").collect();
        if parts.len() != 2 {
            return Err("Invalid week_id format. Expected YYYY-wWW".to_string());
        }
        let year: i32 = parts[0].parse().map_err(|_| "Invalid year in week_id")?;
        let week: i32 = parts[1].parse().map_err(|_| "Invalid week in week_id")?;

        let rates_stream = client
            .query(
                "SELECT PartNumber, Qty FROM dbo.DailyRate WHERE Week = @p1 AND Year = @p2",
                &[&week, &year],
            )
            .await
            .map_err(|e| e.to_string())?;
        let rates_rows = rates_stream.into_first_result().await.map_err(|e| e.to_string())?;

        // 3. Setup Target Date
        let jan4 = NaiveDate::from_ymd_opt(year, 1, 4).unwrap();
        let day_of_week = jan4.weekday().num_days_from_monday();
        let monday_wk1 = jan4 - Duration::days(day_of_week as i64);
        let target_monday = monday_wk1 + Duration::weeks((week - 1) as i64);
        let delivery_deadline = target_monday + Duration::days(4); // Friday

        // 4. Clear existing UpstreamDemand
        let start_date = target_monday;
        let end_date = target_monday + Duration::days(6);
        let start_date_str = start_date.format("%Y-%m-%d").to_string();
        let end_date_str = end_date.format("%Y-%m-%d").to_string();
        client.execute(
            "DELETE FROM dbo.UpstreamDemand WHERE TargetDate BETWEEN @p1 AND @p2",
            &[&start_date_str, &end_date_str],
        ).await.map_err(|e| e.to_string())?;

        let mut virtual_inventory: HashMap<(String, String), i32> = HashMap::new();

        // 5. Iterate through each Part and its Routing
        for row in rates_rows {
            let part_number = row.get::<&str, _>("PartNumber").unwrap().trim().to_string();
            let qty = get_i32_robust(&row, "Qty").unwrap_or(0);
            if qty <= 0 { continue; }

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

                let inventory_key = (part_number.clone(), process_name.clone());
                let current_inventory = virtual_inventory.get(&inventory_key).copied().unwrap_or(0);

                let net_needed = (current_qty - current_inventory).max(0);
                let consumed_inventory = current_inventory - (current_inventory - current_qty).max(0);
                *virtual_inventory.entry(inventory_key.clone()).or_insert(0) -= consumed_inventory;

                let required_qty = if net_needed > 0 {
                    let batches = (net_needed as f64 / batch_size as f64).ceil() as i32;
                    let produced = batches * batch_size;
                    let overproduction = produced - net_needed;
                    *virtual_inventory.entry(inventory_key.clone()).or_insert(0) += overproduction;
                    produced
                } else {
                    0
                };

                if required_qty > 0 {
                    client.execute(
                        "INSERT INTO dbo.UpstreamDemand (PartNumber, ProcessName, TargetDate, TargetShift, RequiredQty)
                         VALUES (@p1, @p2, @p3, @p4, @p5)",
                        &[&part_number, &process_name, &current_date.format("%Y-%m-%d").to_string(), &current_shift, &required_qty],
                    ).await.map_err(|e| e.to_string())?;
                }

                current_qty = required_qty;

                // Offset lead time for the NEXT upstream sequence
                let mut shifts_to_offset = transit_shifts;
                while shifts_to_offset > 0 {
                    let (prev_date, prev_shift) = get_previous_shift(current_date, &current_shift, &anchors);
                    current_date = prev_date;
                    current_shift = prev_shift;

                    if let Some(anchor) = anchors.get(&current_shift) {
                        if is_working_day(current_date, *anchor) {
                            shifts_to_offset -= 1;
                        }
                    } else {
                        shifts_to_offset -= 1;
                    }
                }
            }
        }
        Ok(())
    }.await;

    if result.is_err() {
        let _ = client.simple_query("ROLLBACK TRANSACTION").await;
        return result;
    }
    client.simple_query("COMMIT TRANSACTION").await.map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn generate_cascaded_demand_from_schedule(
    app: AppHandle,
    connection_string: String,
    week_id: String,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client.simple_query("BEGIN TRANSACTION").await.map_err(|e| e.to_string())?;

    let result: Result<(), String> = async {
        let mut anchors = HashMap::new();
        if let Some(store) = app.get_store("store.json") {
            if let Some(shift_settings_val) = store.get("shiftSettings") {
                if let Ok(shift_settings) = serde_json::from_value::<HashMap<String, String>>(shift_settings_val) {
                    for (shift, date_str) in shift_settings {
                        if let Ok(date) = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d") {
                            anchors.insert(shift, date);
                        }
                    }
                }
            }
        }

        client.execute("TRUNCATE TABLE dbo.UpstreamDemand", &[]).await.map_err(|e| e.to_string())?;

        let schedule_query = "
        SELECT 
            es.PartNumber, 
            SUM(es.Qty) as TotalQty, 
            CONVERT(VARCHAR, es.Date, 23) as TargetDateStr, 
            es.Shift as TargetShift, 
            vw.SequenceNumber as TerminalSeq,
            vw.ProcessName as TerminalProcess
        FROM dbo.EquipmentSchedule es
        INNER JOIN dbo.vw_TerminalProcesses vw ON es.PartNumber = vw.PartNumber
        WHERE es.WeekIdentifier = @p1
        GROUP BY es.PartNumber, es.Date, es.Shift, vw.SequenceNumber, vw.ProcessName
    ";
    let stream = client.query(schedule_query, &[&week_id]).await.map_err(|e| e.to_string())?;
    let scheduled_rows = stream.into_first_result().await.map_err(|e| e.to_string())?;

    let mut demand_map: HashMap<(String, String, NaiveDate, String), i32> = HashMap::new();
    let mut missing_routings = Vec::new();

    // Group scheduled rows by PartNumber
    let mut parts_schedule: HashMap<String, (i32, String, Vec<(NaiveDate, String, i32)>)> = HashMap::new();
    for row in scheduled_rows {
        let part_number = row.get::<&str, _>("PartNumber").unwrap().trim().to_string();
        let qty = get_i32_robust(&row, "TotalQty").unwrap_or(0);
        let date_str = row.get::<&str, _>("TargetDateStr").unwrap().trim().to_string();
        let target_shift = row.get::<&str, _>("TargetShift").unwrap().trim().to_string();
        let terminal_seq = get_i32_robust(&row, "TerminalSeq").unwrap_or(0);
        let terminal_proc = row.get::<&str, _>("TerminalProcess").unwrap().trim().to_string();

        if qty <= 0 { continue; }
        let target_date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").unwrap();

        let entry = parts_schedule.entry(part_number).or_insert((terminal_seq, terminal_proc, Vec::new()));
        entry.2.push((target_date, target_shift, qty));
    }

    let mut virtual_inventory: HashMap<(String, String), i32> = HashMap::new();

    for (part_number, (terminal_seq, terminal_proc, schedules)) in parts_schedule {
        let routing_stream = client.query(
            "SELECT ProcessName, SequenceNumber, ProcessingTimeMins, BatchSize, TransitShifts 
             FROM dbo.PartRoutings 
             WHERE PartNumber = @p1 AND SequenceNumber <= @p2 
             ORDER BY SequenceNumber DESC",
            &[&part_number, &terminal_seq],
        ).await.map_err(|e| e.to_string())?;
        let routing_rows = routing_stream.into_first_result().await.map_err(|e| e.to_string())?;

        if routing_rows.is_empty() && terminal_seq == 0 {
            missing_routings.push(part_number.clone());
            continue;
        }

        let mut raw_demand: HashMap<(NaiveDate, String), i32> = HashMap::new();
        for (date, shift, qty) in schedules {
            *raw_demand.entry((date, shift.clone())).or_insert(0) += qty;
            // Removed inserting terminal_proc directly into demand_map here, because we handle it in the loop
        }

            for route_row in routing_rows {
                let process_name = route_row.get::<&str, _>("ProcessName").unwrap().trim().to_string();
                let sequence_number = get_i32_robust(&route_row, "SequenceNumber").unwrap_or(0);
                let transit_shifts = get_i32_robust(&route_row, "TransitShifts").unwrap_or(0);
                let batch_size = get_i32_robust(&route_row, "BatchSize").unwrap_or(1);

                let mut next_raw_demand: HashMap<(NaiveDate, String), i32> = HashMap::new();

                let mut sorted_demands: Vec<_> = raw_demand.into_iter().collect();
                sorted_demands.sort_by(|a, b| {
                    let date_cmp = b.0.0.cmp(&a.0.0);
                    if date_cmp != std::cmp::Ordering::Equal {
                        return date_cmp;
                    }
                    let shift_a = match a.0.1.as_str() { "A" | "C" => 1, _ => 2 };
                    let shift_b = match b.0.1.as_str() { "A" | "C" => 1, _ => 2 };
                    shift_b.cmp(&shift_a)
                });

                for ((date, shift), total_raw_qty) in sorted_demands {
                    let produced_qty;

                    if sequence_number == terminal_seq {
                        produced_qty = total_raw_qty;
                        let key = (part_number.clone(), process_name.clone(), date.clone(), shift.clone());
                        *demand_map.entry(key).or_insert(0) += produced_qty;
                    } else {
                        let inventory_key = (part_number.clone(), process_name.clone());
                        let current_inventory = virtual_inventory.get(&inventory_key).copied().unwrap_or(0);

                        let net_needed = (total_raw_qty - current_inventory).max(0);
                        let consumed_inventory = current_inventory - (current_inventory - total_raw_qty).max(0);
                        *virtual_inventory.entry(inventory_key.clone()).or_insert(0) -= consumed_inventory;

                        if net_needed > 0 {
                            let batches = (net_needed as f64 / batch_size as f64).ceil() as i32;
                            produced_qty = batches * batch_size;
                            let overproduction = produced_qty - net_needed;

                            *virtual_inventory.entry(inventory_key.clone()).or_insert(0) += overproduction;

                            let key = (part_number.clone(), process_name.clone(), date.clone(), shift.clone());
                            *demand_map.entry(key).or_insert(0) += produced_qty;
                        } else {
                            produced_qty = 0;
                        }
                    }
                    if produced_qty > 0 {
                        *next_raw_demand.entry((date, shift)).or_insert(0) += produced_qty;
                    }
                }

                let mut output_raw_demand: HashMap<(NaiveDate, String), i32> = HashMap::new();
                for ((date, shift), total_produced_qty) in next_raw_demand {
                    let mut current_date = date;
                    let mut current_shift = shift.clone();
                    let mut shifts_to_offset = transit_shifts;

                    while shifts_to_offset > 0 {
                        let (prev_date, prev_shift) = get_previous_shift(current_date, &current_shift, &anchors);
                        current_date = prev_date;
                        current_shift = prev_shift;

                        if let Some(anchor) = anchors.get(&current_shift) {
                            if is_working_day(current_date, *anchor) {
                                shifts_to_offset -= 1;
                            }
                        } else {
                            shifts_to_offset -= 1;
                        }
                    }
                    *output_raw_demand.entry((current_date, current_shift)).or_insert(0) += total_produced_qty;
                }

                raw_demand = output_raw_demand;
            }
        }

        if !missing_routings.is_empty() {
            println!("Warning: Missing routings for parts: {:?}", missing_routings);
        }

        for ((part_number, process_name, target_date, target_shift), required_qty) in demand_map {
            client.execute(
                "INSERT INTO dbo.UpstreamDemand (PartNumber, ProcessName, TargetDate, TargetShift, RequiredQty)
                 VALUES (@p1, @p2, @p3, @p4, @p5)",
                &[&part_number, &process_name, &target_date.format("%Y-%m-%d").to_string(), &target_shift, &required_qty],
            ).await.map_err(|e| e.to_string())?;
        }

        Ok(())
    }.await;

    if result.is_err() {
        let _ = client.simple_query("ROLLBACK TRANSACTION").await;
        return result;
    }
    client.simple_query("COMMIT TRANSACTION").await.map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn commit_mrp_plan(
    connection_string: String,
    week_id: String,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;

    let demand_stream = client.query(
        "SELECT PartNumber, ProcessName, CONVERT(VARCHAR, TargetDate, 23) as TargetDate, TargetShift, RequiredQty 
         FROM dbo.UpstreamDemand",
        &[],
    ).await.map_err(|e| e.to_string())?;
    let demand_rows = demand_stream.into_first_result().await.map_err(|e| e.to_string())?;

    client.simple_query("BEGIN TRANSACTION").await.map_err(|e| e.to_string())?;

    // Step 1: Clear out previous MRP runs for the target week_id to prevent duplicates
    client.execute(
        "DELETE FROM dbo.EquipmentSchedule WHERE IsMRPGenerated = 1 AND WeekIdentifier = @p1",
        &[&week_id]
    ).await.map_err(|e| e.to_string())?;

    for row in demand_rows {
        let part_number = row.get::<&str, _>("PartNumber").unwrap().trim().to_string();
        let department = row.get::<&str, _>("ProcessName").unwrap().trim().to_string();
        let date_str = row.get::<&str, _>("TargetDate").unwrap().trim().to_string();
        let shift = row.get::<&str, _>("TargetShift").unwrap().trim().to_string();
        let qty = get_i32_robust(&row, "RequiredQty").unwrap_or(0);

        // Step 2: Calculate dynamic ISO week for every row
        let target_date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
            .map_err(|e| format!("Invalid date in UpstreamDemand: {}", e))?;
        let iso_week = target_date.iso_week();
        let dynamic_week_id = format!("{}-w{:02}", iso_week.year(), iso_week.week());

        client.execute(
            "MERGE dbo.EquipmentSchedule AS target
             USING (SELECT @p1 as WeekIdentifier, @p2 as Department, @p3 as Date, @p4 as Shift, @p5 as PartNumber) AS source
             ON (target.WeekIdentifier = source.WeekIdentifier AND target.Department = source.Department AND target.Date = source.Date AND target.Shift = source.Shift AND target.PartNumber = source.PartNumber)
             WHEN MATCHED THEN
                UPDATE SET Qty = target.Qty + @p6, IsMRPGenerated = 1
             WHEN NOT MATCHED THEN
                INSERT (WeekIdentifier, Department, MachineID, Date, Shift, PartNumber, Qty, RunSequence, IsMRPGenerated)
                VALUES (@p1, @p2, 'General', @p3, @p4, @p5, @p6, 0, 1);",
            &[&dynamic_week_id, &department, &date_str, &shift, &part_number, &qty],
        ).await.map_err(|e| e.to_string())?;

        let day_of_week = match target_date.weekday() {
            chrono::Weekday::Mon => "Mon",
            chrono::Weekday::Tue => "Tue",
            chrono::Weekday::Wed => "Wed",
            chrono::Weekday::Thu => "Thu",
            chrono::Weekday::Fri => "Fri",
            chrono::Weekday::Sat => "Sat",
            chrono::Weekday::Sun => "Sun",
        }.to_string();

        client.execute(
            "MERGE dbo.DeliveryData AS target
             USING (SELECT @p1 as Department, @p2 as WeekIdentifier, @p3 as PartNumber, @p4 as DayOfWeek, 
                           @p5 as Target, CAST(@p6 as DATE) as Date, @p7 as Shift) AS source
             ON (target.Department = source.Department AND target.PartNumber = source.PartNumber 
                  AND CAST(target.Date AS DATE) = source.Date 
                  AND (target.Shift = source.Shift OR (target.Shift IS NULL AND source.Shift = 'A')))
             WHEN MATCHED THEN
                UPDATE SET Target = target.Target + source.Target, WeekIdentifier = source.WeekIdentifier, 
                           DayOfWeek = source.DayOfWeek, Shift = source.Shift, IsMRPGenerated = 1
             WHEN NOT MATCHED THEN
                INSERT (Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Date, Shift, IsMRPGenerated)
                VALUES (source.Department, source.WeekIdentifier, source.PartNumber, source.DayOfWeek, 
                        source.Target, source.Date, source.Shift, 1);",
            &[&department, &dynamic_week_id, &part_number, &day_of_week, &qty, &date_str, &shift],
        ).await.map_err(|e| e.to_string())?;
    }

    client.simple_query("COMMIT TRANSACTION").await.map_err(|e| e.to_string())?;

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
    part_filter: Option<Vec<String>>,
    process_filter: Option<String>,
) -> Result<Vec<PartRouting>, String> {
    let mut client = create_client(&connection_string).await?;
    
    let mut conditions = Vec::new();
    let mut params: Vec<Box<dyn tiberius::ToSql>> = Vec::new();

    if let Some(parts) = part_filter {
        if !parts.is_empty() {
            let placeholders: Vec<String> = parts.iter().enumerate().map(|(i, _)| format!("@p{}", i + 1)).collect();
            conditions.push(format!("PartNumber IN ({})", placeholders.join(", ")));
            for p in parts {
                params.push(Box::new(p));
            }
        }
    }

    if let Some(process) = process_filter {
        if !process.is_empty() {
            let p_idx = params.len() + 1;
            conditions.push(format!("ProcessName = @p{}", p_idx));
            params.push(Box::new(process));
        }
    }

    let where_clause = if conditions.is_empty() {
        "".to_string()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let query = format!(
        "SELECT RoutingID, PartNumber, ProcessName, SequenceNumber, ProcessingTimeMins, BatchSize, TransitShifts 
         FROM dbo.PartRoutings {} ORDER BY PartNumber ASC, SequenceNumber ASC",
        where_clause
    );

    // Convert Vec<Box<dyn ToSql>> to Vec<&dyn ToSql>
    let param_refs: Vec<&dyn tiberius::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let stream = client.query(query, &param_refs).await.map_err(|e| e.to_string())?;
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
        let pn = rec.part_number.trim();
        let pr = rec.process_name.trim();
        
        if pn.is_empty() || pr.is_empty() {
            continue;
        }

        // 1. Ensure part exists in ItemMaster
        client.execute(
            "IF NOT EXISTS (SELECT 1 FROM dbo.ItemMaster WHERE PartNumber = @p1)
             INSERT INTO dbo.ItemMaster (PartNumber) VALUES (@p1)",
            &[&pn],
        ).await.map_err(|e| e.to_string())?;

        // 2. Upsert into PartRoutings
        client.execute(
            "MERGE dbo.PartRoutings AS target
             USING (SELECT @p1 as PartNumber, @p2 as SequenceNumber) AS source
             ON (target.PartNumber = source.PartNumber AND target.SequenceNumber = source.SequenceNumber)
             WHEN MATCHED THEN
                UPDATE SET ProcessName = @p3, ProcessingTimeMins = @p4, BatchSize = @p5, TransitShifts = @p6
             WHEN NOT MATCHED THEN
                INSERT (PartNumber, ProcessName, SequenceNumber, ProcessingTimeMins, BatchSize, TransitShifts)
                VALUES (@p1, @p3, @p2, @p4, @p5, @p6);",
            &[&pn, &rec.sequence_number, &pr, &rec.processing_time_mins, &rec.batch_size, &rec.transit_shifts],
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

#[tauri::command]
pub async fn validate_schedule_feasibility(
    app: tauri::AppHandle,
    connection_string: String,
    week_id: String,
) -> Result<Vec<String>, String> {
    let mut client = create_client(&connection_string).await?;

    // 1. Load Shift Settings/Anchors for Panama schedule
    let mut anchors = HashMap::new();
    if let Some(store) = app.get_store("store.json") {
        if let Some(shift_settings_val) = store.get("shiftSettings") {
            if let Ok(shift_settings) = serde_json::from_value::<HashMap<String, String>>(shift_settings_val) {
                for (shift, date_str) in shift_settings {
                    if let Ok(date) = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d") {
                        anchors.insert(shift, date);
                    }
                }
            }
        }
    }

    // 2. Fetch EquipmentSchedule joined with PartRoutings
    let query = "
        SELECT 
            es.PartNumber, 
            CONVERT(VARCHAR, es.Date, 23) as DateStr, 
            es.Shift, 
            pr.SequenceNumber, 
            pr.TransitShifts,
            pr.ProcessName
        FROM dbo.EquipmentSchedule es
        INNER JOIN dbo.PartRoutings pr ON es.PartNumber = pr.PartNumber AND es.Department = pr.ProcessName
        WHERE es.WeekIdentifier = @p1
        ORDER BY es.PartNumber, pr.SequenceNumber ASC
    ";

    let stream = client.query(query, &[&week_id]).await.map_err(|e| e.to_string())?;
    let rows = stream.into_first_result().await.map_err(|e| e.to_string())?;

    let mut conflicts = Vec::new();
    let mut part_groups: HashMap<String, Vec<(NaiveDate, String, i32, i32, String)>> = HashMap::new();

    for row in rows {
        let pn = row.get::<&str, _>("PartNumber").unwrap().trim().to_string();
        let date_str = row.get::<&str, _>("DateStr").unwrap().trim();
        let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").unwrap();
        let shift = row.get::<&str, _>("Shift").unwrap().trim().to_string();
        let seq = row.get::<i32, _>("SequenceNumber").unwrap();
        let transit = row.get::<i32, _>("TransitShifts").unwrap();
        let proc = row.get::<&str, _>("ProcessName").unwrap().trim().to_string();

        part_groups.entry(pn).or_default().push((date, shift, seq, transit, proc));
    }

    // 3. Check sequence feasibility
    for (pn, steps) in part_groups {
        for i in 0..steps.len() - 1 {
            let (d1, s1, seq1, transit1, proc1) = &steps[i];
            let (d2, s2, seq2, _transit2, proc2) = &steps[i + 1];

            // Calculate working shifts between (d1, s1) and (d2, s2)
            let mut gap = 0;
            let mut curr_d = *d1;
            let mut curr_s = s1.clone();

            let mut checks = 0;
            let max_checks = 200; // Limit search range to prevent infinite loops

            while (curr_d < *d2 || (curr_d == *d2 && curr_s != *s2)) && checks < max_checks {
                checks += 1;
                
                // Move to NEXT shift
                let (next_d, next_s) = if curr_s == "A" {
                    (curr_d, "B".to_string())
                } else if curr_s == "B" {
                    (curr_d + Duration::days(1), "A".to_string())
                } else if curr_s == "C" {
                    (curr_d, "D".to_string())
                } else if curr_s == "D" {
                    (curr_d + Duration::days(1), "C".to_string())
                } else {
                    // Fallback for unknown shifts
                    (curr_d + Duration::days(1), "A".to_string())
                };

                curr_d = next_d;
                curr_s = next_s;

                if let Some(anchor) = anchors.get(&curr_s) {
                    if is_working_day(curr_d, *anchor) {
                        gap += 1;
                    }
                }
            }

            if gap < *transit1 {
                conflicts.push(format!(
                    "Part {}: Conflict between Seq {} ({}) and Seq {} ({}). Required {} transit shifts, but only {} available.",
                    pn, seq1, proc1, seq2, proc2, transit1, gap
                ));
            }
        }
    }

    Ok(conflicts)
}
