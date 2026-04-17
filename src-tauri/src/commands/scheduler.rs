use crate::models::*;
use crate::db::*;
use std::collections::HashMap;

pub fn is_working_day(date_str: &str, anchor_date_str: &str) -> bool {
    if anchor_date_str.is_empty() {
        return true;
    }
    use chrono::NaiveDate;

    let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok();
    let anchor_date = NaiveDate::parse_from_str(anchor_date_str, "%Y-%m-%d").ok();

    if let (Some(d1), Some(d2)) = (date, anchor_date) {
        let diff_days = (d1 - d2).num_days();
        let cycle_day = ((diff_days % 14) + 14) % 14;

        let working_pattern = [
            true, true, // Days 0, 1
            false, false, // Days 2, 3
            true, true, true, // Days 4, 5, 6
            false, false, // Days 7, 8
            true, true, // Days 9, 10
            false, false, false, // Days 11, 12, 13
        ];

        working_pattern[cycle_day as usize]
    } else {
        true
    }
}

#[tauri::command]
pub async fn calculate_demand_distribution(
    req: DistributeDemandRequest,
) -> Result<Vec<DistributeDemandResult>, String> {
    #[derive(Debug)]
    struct ValidSlot {
        row_id: String,
        day: String,
        #[allow(dead_code)]
        day_idx: usize,
        #[allow(dead_code)]
        shift: String,
        capacity: f64,
        base_assignment: i32,
    }

    let days_of_week = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let mut valid_slots: Vec<ValidSlot> = Vec::new();

    for (day_idx, day_name) in days_of_week.iter().enumerate() {
        if let Some(Some(date_str)) = req.week_dates.get(day_idx) {
            for part in &req.child_rows {
                let anchor_date = req
                    .anchor_dates
                    .get(&part.shift)
                    .map(|s| s.as_str())
                    .unwrap_or("");
                if is_working_day(date_str, anchor_date) {
                    if let Some(capacities) = req.shift_capacities.get(day_idx) {
                        let capacity = capacities.get(&part.shift).copied().unwrap_or(0.0);
                        if capacity > 0.0 {
                            valid_slots.push(ValidSlot {
                                row_id: part.id.clone(),
                                day: day_name.to_string(),
                                day_idx,
                                shift: part.shift.clone(),
                                capacity,
                                base_assignment: 0,
                            });
                        }
                    }
                }
            }
        }
    }

    let total_weekly_capacity: f64 = valid_slots.iter().map(|s| s.capacity).sum();

    if valid_slots.is_empty() || total_weekly_capacity == 0.0 {
        return Ok(Vec::new());
    }

    let mut assigned_count = 0;
    for slot in &mut valid_slots {
        let base =
            (req.total_demand as f64 * (slot.capacity / total_weekly_capacity)).floor() as i32;
        slot.base_assignment = base;
        assigned_count += base;
    }

    let mut remainder = req.total_demand - assigned_count;

    if remainder > 0 {
        valid_slots.sort_by(|a, b| {
            let unused_a =
                a.capacity - ((a.base_assignment as f64 * req.processing_time_min) / 60.0);
            let unused_b =
                b.capacity - ((b.base_assignment as f64 * req.processing_time_min) / 60.0);
            unused_b
                .partial_cmp(&unused_a)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let mut i = 0;
        let len = valid_slots.len();
        while remainder > 0 {
            valid_slots[i % len].base_assignment += 1;
            remainder -= 1;
            i += 1;
        }
    }

    let result = valid_slots
        .into_iter()
        .map(|slot| DistributeDemandResult {
            row_id: slot.row_id,
            day: slot.day,
            value: slot.base_assignment,
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn submit_shift_production(
    connection_string: String,
    records: Vec<ShiftProductionRecord>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    for rec in records {
        let normalized_part = rec.part_number.trim().to_uppercase();
        let normalized_shift = if rec.shift.trim().is_empty() {
            "A".to_string()
        } else {
            rec.shift.trim().to_uppercase()
        };

        client.execute(
            "MERGE dbo.DeliveryData AS target
             USING (SELECT @p1 as Department, @p2 as WeekIdentifier, @p3 as PartNumber, @p4 as DayOfWeek, 
                           @p5 as Target, @p6 as Actual, CAST(@p7 as DATE) as Date, @p8 as Shift, @p9 as ReasonCode) AS source
             ON (target.Department = source.Department AND target.PartNumber = source.PartNumber 
                  AND CAST(target.Date AS DATE) = source.Date 
                  AND (target.Shift = source.Shift OR (target.Shift IS NULL AND source.Shift = 'A')))
             WHEN MATCHED THEN
                UPDATE SET Target = source.Target, Actual = source.Actual, WeekIdentifier = source.WeekIdentifier, 
                           DayOfWeek = source.DayOfWeek, ReasonCode = source.ReasonCode, Shift = source.Shift
             WHEN NOT MATCHED THEN
                INSERT (Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, Date, Shift, ReasonCode)
                VALUES (source.Department, source.WeekIdentifier, source.PartNumber, source.DayOfWeek, 
                        source.Target, source.Actual, source.Date, source.Shift, source.ReasonCode);",
            &[&rec.department, &rec.week_identifier, &normalized_part, &rec.day_of_week,
              &rec.target, &rec.actual, &rec.date, &normalized_shift, &rec.reason_code],
        ).await.map_err(|e| {
            // Attempt rollback on error (best-effort)
            e.to_string()
        })?;
    }

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_machine_utilization(
    connection_string: String,
    week_id: String,
    process_name: String,
) -> Result<SchedulerState, String> {
    let mut client = create_client(&connection_string).await?;

    // 1. Get machines for this process
    let machine_query = "SELECT DISTINCT MachineID FROM dbo.ProcessInfo WHERE ProcessName = @p1 AND WeekIdentifier = @p2 AND MachineID IS NOT NULL";
    let rows = client
        .query(machine_query, &[&process_name, &week_id])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let mut machine_ids: Vec<String> = rows
        .iter()
        .map(|r| {
            r.get::<&str, _>("MachineID")
                .unwrap_or_default()
                .trim()
                .to_string()
        })
        .collect();
    if machine_ids.is_empty() {
        machine_ids.push("General".to_string());
    }

    // 2. Get capacity (hours_available) for each machine
    let capacity_query = "SELECT MachineID, CONVERT(VARCHAR, Date, 23) as Date, Shift, HoursAvailable FROM dbo.ProcessInfo WHERE ProcessName = @p1 AND WeekIdentifier = @p2";
    let rows = client
        .query(capacity_query, &[&process_name, &week_id])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let mut capacities: HashMap<
        String,
        HashMap<String, HashMap<String, f64>>,
    > = HashMap::new();
    for row in rows {
        let m_id = row
            .get::<&str, _>("MachineID")
            .unwrap_or("General")
            .trim()
            .to_string();
        let date = row
            .get::<&str, _>("Date")
            .unwrap_or_default()
            .trim()
            .to_string();
        let shift = row
            .get::<&str, _>("Shift")
            .unwrap_or("A")
            .trim()
            .to_string();
        let hours = get_i32_robust(&row, "HoursAvailable").unwrap_or(0) as f64;

        capacities
            .entry(m_id)
            .or_default()
            .entry(date)
            .or_default()
            .insert(shift, hours);
    }

    // 3. Get jobs (DeliveryData) for this process/week
    let jobs_query = "
        SELECT DD.PartNumber, DD.Shift, DD.Target, CONVERT(VARCHAR, DD.Date, 23) as Date, DD.DayOfWeek, PI.BatchSize, PI.ProcessingTime 
        FROM dbo.DeliveryData DD
        LEFT JOIN dbo.PartInfo PI ON DD.PartNumber = PI.PartNumber AND DD.Department = PI.ProcessName
        WHERE DD.Department = @p1 AND DD.WeekIdentifier = @p2
    ";
    let rows = client
        .query(jobs_query, &[&process_name, &week_id])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let mut unassigned: Vec<JobBlock> = Vec::new();
    let mut machine_schedules: HashMap<String, MachineSchedule> =
        HashMap::new();

    for m_id in &machine_ids {
        machine_schedules.insert(
            m_id.clone(),
            MachineSchedule {
                machine_id: m_id.clone(),
                daily_capacity_hrs: 0.0,
                schedule: HashMap::new(),
            },
        );
    }

    for row in rows {
        let p_num = row
            .get::<&str, _>("PartNumber")
            .unwrap_or_default()
            .trim()
            .to_string();
        let target = get_i32_robust(&row, "Target").unwrap_or(0) as i32;
        let p_time = get_i32_robust(&row, "ProcessingTime").unwrap_or(0) as f64;
        let b_size = get_i32_robust(&row, "BatchSize").map(|v| v as i32);
        let date = row
            .get::<&str, _>("Date")
            .unwrap_or_default()
            .trim()
            .to_string();
        let shift = row
            .get::<&str, _>("Shift")
            .unwrap_or("A")
            .trim()
            .to_string();

        if target <= 0 {
            continue;
        }

        let job = JobBlock {
            id: format!(
                "{}-{}-{}-{}",
                p_num,
                date,
                shift,
                chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
            ),
            part_number: p_num,
            shift: shift.clone(),
            target_qty: target,
            processing_time_mins: p_time,
            standard_batch_size: b_size,
            batch_index: 0,
            is_batch_split: false,
        };

        unassigned.push(job);
    }

    // Populate day/shift slots for each machine
    for (m_id, m_sched) in &mut machine_schedules {
        if let Some(m_caps) = capacities.get(m_id) {
            for (date, shifts) in m_caps {
                let mut day_slots = HashMap::new();
                for (shift, hrs) in shifts {
                    day_slots.insert(
                        shift.clone(),
                        ShiftSchedule {
                            jobs: Vec::new(),
                            capacity_hrs: *hrs,
                            total_assigned_hours: 0.0,
                        },
                    );
                }
                m_sched.schedule.insert(date.clone(), day_slots);
            }
        }
    }

    Ok(SchedulerState {
        unassigned,
        machines: machine_schedules,
    })
}

#[tauri::command]
pub async fn update_job_machine_assignment(req: JobAssignment) -> Result<(), String> {
    println!(
        "Assigning job {} to machine {:?} on {}",
        req.job_id, req.machine_id, req.date
    );
    Ok(())
}

#[tauri::command]
pub async fn get_scheduler_meta(connection_string: String) -> Result<SchedulerMeta, String> {
    let mut client = create_client(&connection_string).await?;

    // Get Active Weeks
    let week_query =
        "SELECT DISTINCT WeekIdentifier FROM dbo.DeliveryData ORDER BY WeekIdentifier DESC";
    let rows = client
        .query(week_query, &[])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;
    let active_weeks = rows
        .iter()
        .map(|r| {
            r.get::<&str, _>("WeekIdentifier")
                .unwrap_or_default()
                .trim()
                .to_string()
        })
        .collect();

    // Get Process Hierarchy (Department -> Machines)
    let proc_query =
        "SELECT DISTINCT ProcessName, MachineID FROM dbo.ProcessInfo WHERE MachineID IS NOT NULL";
    let rows = client
        .query(proc_query, &[])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let mut hierarchy: HashMap<String, Vec<String>> =
        HashMap::new();
    for row in rows {
        let p = row
            .get::<&str, _>("ProcessName")
            .unwrap_or_default()
            .trim()
            .to_string();
        let m = row
            .get::<&str, _>("MachineID")
            .unwrap_or_default()
            .trim()
            .to_string();
        hierarchy.entry(p).or_default().push(m);
    }

    Ok(SchedulerMeta {
        active_weeks,
        process_hierarchy: hierarchy,
    })
}

#[tauri::command]
pub async fn save_scheduler_state(_state: SchedulerState) -> Result<(), String> {
    Ok(())
}
