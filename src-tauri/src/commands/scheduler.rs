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

pub fn get_day_name(date_str: &str) -> String {
    use chrono::{Datelike, NaiveDate};
    if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        match date.weekday() {
            chrono::Weekday::Mon => "Mon".to_string(),
            chrono::Weekday::Tue => "Tue".to_string(),
            chrono::Weekday::Wed => "Wed".to_string(),
            chrono::Weekday::Thu => "Thu".to_string(),
            chrono::Weekday::Fri => "Fri".to_string(),
            chrono::Weekday::Sat => "Sat".to_string(),
            chrono::Weekday::Sun => "Sun".to_string(),
        }
    } else {
        date_str.to_string()
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

    // 1. Get machines and capacities (ProcessInfo)
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

    let capacity_query = "SELECT MachineID, CONVERT(VARCHAR, Date, 23) as Date, Shift, HoursAvailable FROM dbo.ProcessInfo WHERE ProcessName = @p1 AND WeekIdentifier = @p2";
    let rows = client
        .query(capacity_query, &[&process_name, &week_id])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let mut capacities: HashMap<String, HashMap<String, HashMap<String, f64>>> = HashMap::new();
    for row in rows {
        let m_id = row.get::<&str, _>("MachineID").unwrap_or("General").trim().to_string();
        let date_str = row.get::<&str, _>("Date").unwrap_or_default().trim().to_string();
        let day_name = get_day_name(&date_str);
        let shift = row.get::<&str, _>("Shift").unwrap_or("A").trim().to_string();
        let hours = get_f64_robust(&row, "HoursAvailable").unwrap_or(0.0);
        capacities.entry(m_id).or_default().entry(day_name).or_default().insert(shift, hours);
    }

    // 2. Load Part Info (Processing Time, Batch Size)
    let part_info_query = "SELECT PartNumber, BatchSize, ProcessingTime FROM dbo.PartInfo WHERE ProcessName = @p1";
    let rows = client
        .query(part_info_query, &[&process_name])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;
    
    let mut part_meta: HashMap<String, (f64, Option<i32>)> = HashMap::new();
    for row in rows {
        let p_num = row.get::<&str, _>("PartNumber").unwrap_or_default().trim().to_string();
        let p_time = get_i32_robust(&row, "ProcessingTime").unwrap_or(0) as f64;
        let b_size = get_i32_robust(&row, "BatchSize");
        part_meta.insert(p_num, (p_time, b_size));
    }

    // 3. Load Base Demand (DeliveryData)
    let demand_query = "SELECT PartNumber, CONVERT(VARCHAR, Date, 23) as Date, Shift, SUM(Target) as TotalTarget 
                        FROM dbo.DeliveryData 
                        WHERE Department = @p1 AND WeekIdentifier = @p2 
                        GROUP BY PartNumber, Date, Shift";
    let rows = client
        .query(demand_query, &[&process_name, &week_id])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    struct DemandBucket {
        date: String,
        shift: String,
        quantity: i32,
    }

    let mut demand_map: HashMap<String, Vec<DemandBucket>> = HashMap::new();
    for row in rows {
        let p_num = row.get::<&str, _>("PartNumber").unwrap_or_default().trim().to_string();
        let date = row.get::<&str, _>("Date").unwrap_or_default().trim().to_string();
        let shift = row.get::<&str, _>("Shift").unwrap_or("A").trim().to_string();
        let target = get_i32_robust(&row, "TotalTarget").unwrap_or(0);
        
        demand_map.entry(p_num).or_default().push(DemandBucket {
            date,
            shift,
            quantity: target,
        });
    }

    // Sort buckets for each part by date then shift for predictable subtraction
    for buckets in demand_map.values_mut() {
        buckets.sort_by(|a, b| a.date.cmp(&b.date).then(a.shift.cmp(&b.shift)));
    }

    // 4. Load Current Schedule (EquipmentSchedule)
    let schedule_query = "SELECT MachineID, CONVERT(VARCHAR, Date, 23) as Date, Shift, PartNumber, Qty, RunSequence 
                          FROM dbo.EquipmentSchedule 
                          WHERE Department = @p1 AND WeekIdentifier = @p2 
                          ORDER BY MachineID, Date, Shift, RunSequence";
    let rows = client
        .query(schedule_query, &[&process_name, &week_id])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let mut machine_schedules: HashMap<String, MachineSchedule> = HashMap::new();
    for m_id in &machine_ids {
        let mut max_daily_cap = 0.0;
        if let Some(m_caps) = capacities.get(m_id) {
            for day_shifts in m_caps.values() {
                let day_total: f64 = day_shifts.values().sum();
                if day_total > max_daily_cap {
                    max_daily_cap = day_total;
                }
            }
        }

        machine_schedules.insert(
            m_id.clone(),
            MachineSchedule {
                machine_id: m_id.clone(),
                daily_capacity_hrs: max_daily_cap,
                schedule: HashMap::new(),
            },
        );
        // Pre-populate with capacities
        if let Some(m_caps) = capacities.get(m_id) {
            for (day_name, shifts) in m_caps {
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
                machine_schedules.get_mut(m_id).unwrap().schedule.insert(day_name.clone(), day_slots);
            }
        }
    }

    for row in rows {
        let m_id = row.get::<&str, _>("MachineID").unwrap_or("General").trim().to_string();
        let date_str = row.get::<&str, _>("Date").unwrap_or_default().trim().to_string();
        let day_name = get_day_name(&date_str);
        let shift = row.get::<&str, _>("Shift").unwrap_or("A").trim().to_string();
        let p_num = row.get::<&str, _>("PartNumber").unwrap_or_default().trim().to_string();
        let qty = get_i32_robust(&row, "Qty").unwrap_or(0);
        
        let (p_time, b_size) = part_meta.get(&p_num).cloned().unwrap_or((0.0, None));
        
        let job = JobBlock {
            id: uuid::Uuid::new_v4().to_string(),
            part_number: p_num.clone(),
            shift: shift.clone(),
            target_qty: qty,
            processing_time_mins: p_time,
            standard_batch_size: b_size,
            batch_index: 0,
            is_batch_split: false,
            original_shift: None,
            original_date: None,
        };

        if let Some(m_sched) = machine_schedules.get_mut(&m_id) {
            let day_sched = m_sched.schedule.entry(day_name.clone()).or_default();
            let shift_sched = day_sched.entry(shift.clone()).or_insert_with(|| ShiftSchedule {
                jobs: Vec::new(),
                capacity_hrs: 0.0,
                total_assigned_hours: 0.0,
            });
            shift_sched.jobs.push(job);
            shift_sched.total_assigned_hours += (qty as f64 * p_time) / 60.0;
        }

        // Subtract from remaining demand using flexible weekly reconciliation
        let mut qty_to_subtract = qty;
        if let Some(buckets) = demand_map.get_mut(&p_num) {
            // First pass: Try exact match (Date + Shift)
            for bucket in buckets.iter_mut() {
                if bucket.date == date_str && bucket.shift == shift {
                    let taken = std::cmp::min(qty_to_subtract, bucket.quantity);
                    bucket.quantity -= taken;
                    qty_to_subtract -= taken;
                    break;
                }
            }
            // Second pass: Subtract remaining scheduled qty from any available bucket for this part (earliest first)
            if qty_to_subtract > 0 {
                for bucket in buckets.iter_mut() {
                    if bucket.quantity > 0 {
                        let taken = std::cmp::min(qty_to_subtract, bucket.quantity);
                        bucket.quantity -= taken;
                        qty_to_subtract -= taken;
                    }
                    if qty_to_subtract <= 0 { break; }
                }
            }
        }
    }

    // 5. Generate Unassigned backlog
    let mut unassigned: Vec<JobBlock> = Vec::new();
    for (p_num, buckets) in demand_map {
        for bucket in buckets {
            if bucket.quantity > 0 {
                let (p_time, b_size) = part_meta.get(&p_num).cloned().unwrap_or((0.0, None));
                unassigned.push(JobBlock {
                    id: format!("{}|{}|{}", p_num, bucket.shift, bucket.date),
                    part_number: p_num.clone(),
                    shift: bucket.shift.clone(),
                    target_qty: bucket.quantity,
                    processing_time_mins: p_time,
                    standard_batch_size: b_size,
                    batch_index: 0,
                    is_batch_split: false,
                    original_shift: Some(bucket.shift),
                    original_date: Some(bucket.date),
                });
            }
        }
    }
    // Sort for stability in the UI list
    unassigned.sort_by(|a, b| a.id.cmp(&b.id));

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
        "SELECT DISTINCT ProcessName, MachineID FROM dbo.Process WHERE MachineID IS NOT NULL";
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

    // Get Part -> Machine Routing
    let map_query = "SELECT PartNumber, MachineID FROM dbo.PartMachineCapability WHERE MachineID IS NOT NULL AND PartNumber IS NOT NULL";
    let rows = client
        .query(map_query, &[])
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let mut part_machine_map: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let p = row
            .get::<&str, _>("PartNumber")
            .unwrap_or_default()
            .trim()
            .to_string();
        let m = row
            .get::<&str, _>("MachineID")
            .unwrap_or_default()
            .trim()
            .to_string();
        part_machine_map.entry(p).or_default().push(m);
    }

    Ok(SchedulerMeta {
        active_weeks,
        process_hierarchy: hierarchy,
        part_machine_map,
    })
}

#[tauri::command]
pub async fn save_scheduler_state(
    connection_string: String,
    department: String,
    week_id: String,
    assignments: Vec<JobAssignmentPayload>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;

    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    // 1. Delete existing schedule for this week/department
    client
        .execute(
            "DELETE FROM dbo.EquipmentSchedule WHERE WeekIdentifier = @p1 AND Department = @p2",
            &[&week_id, &department],
        )
        .await
        .map_err(|e| {
            // Rollback not strictly necessary if we return error and don't commit, 
            // but good practice if the client stays open.
            e.to_string()
        })?;

    // 2. Insert new assignments
    for assn in assignments {
        client.execute(
            "INSERT INTO dbo.EquipmentSchedule (WeekIdentifier, Department, MachineID, Date, Shift, PartNumber, Qty, RunSequence)
             VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8)",
            &[
                &assn.week_identifier,
                &department,
                &assn.machine_id,
                &assn.date,
                &assn.shift,
                &assn.part_number,
                &assn.qty,
                &assn.run_sequence,
            ],
        ).await.map_err(|e| e.to_string())?;
    }

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn calculate_optimal_schedule(mut request: ScheduleRequest) -> ScheduleResponse {
    // 1. Sort backlog_items by priority (highest first)
    request.backlog_items.sort_by(|a, b| b.priority.cmp(&a.priority));

    // 2. Index capabilities and machine_states
    let mut capabilities_map: HashMap<String, Vec<&PartMachineCapability>> = HashMap::new();
    for cap in &request.capabilities {
        capabilities_map.entry(cap.part_id.clone()).or_default().push(cap);
    }
    
    // Sort capabilities per part by parts_per_hour (fastest first)
    for caps in capabilities_map.values_mut() {
        caps.sort_by(|a, b| b.parts_per_hour.partial_cmp(&a.parts_per_hour).unwrap_or(std::cmp::Ordering::Equal));
    }

    // Index machine_states by (machine_id, shift) for shift-strict capacity tracking
    let mut machine_states_map: HashMap<(String, String), MachineState> = HashMap::new();
    for state in request.machine_states {
        machine_states_map.insert((state.machine_id.clone(), state.shift.clone()), state);
    }

    let mut newly_scheduled: Vec<ScheduledTask> = Vec::new();
    let mut remaining_backlog: Vec<BacklogItem> = Vec::new();

    // 3. Loop through sorted backlog items
    for mut item in request.backlog_items {
        let mut fully_scheduled = false;

        if let Some(eligible_caps) = capabilities_map.get(&item.part_id) {
            // 4. For each part, finding eligible machines is already sorted by fastest first
            for cap in eligible_caps {
                if cap.parts_per_hour <= 0.0 || item.quantity == 0 {
                    continue;
                }

                // Look up specific Machine + Shift capacity using composite key
                if let Some(machine) = machine_states_map.get_mut(&(cap.machine_id.clone(), item.shift.clone())) {
                    if machine.total_capacity_hours <= 0.0 || machine.current_utilization_pct >= machine.max_utilization_pct {
                        continue;
                    }

                    // Calculate how many hours we can still assign to this machine shift
                    let remaining_pct = machine.max_utilization_pct - machine.current_utilization_pct;
                    let remaining_hours = (remaining_pct / 100.0) * machine.total_capacity_hours;

                    // Calculate how many parts can fit into the remaining hours
                    let max_parts_fit = (remaining_hours * cap.parts_per_hour).floor() as u32;
                    let parts_to_schedule = std::cmp::min(item.quantity, max_parts_fit);

                    if parts_to_schedule > 0 {
                        // 5. Calculate estimated hours
                        let estimated_hours = parts_to_schedule as f64 / cap.parts_per_hour;

                        // 6. Calculate utilization impact percentage
                        let utilization_impact = (estimated_hours / machine.total_capacity_hours) * 100.0;

                        // 8. Assign part to machine shift
                        machine.current_utilization_pct += utilization_impact;

                        newly_scheduled.push(ScheduledTask {
                            backlog_item_id: item.id.clone(),
                            part_id: item.part_id.clone(),
                            machine_id: machine.machine_id.clone(),
                            shift: machine.shift.clone(),
                            quantity: parts_to_schedule,
                            estimated_hours,
                            added_utilization_pct: utilization_impact,
                        });

                        item.quantity -= parts_to_schedule;

                        if item.quantity == 0 {
                            fully_scheduled = true;
                            break;
                        }
                    }
                }
            }
        }

        // 9. If no machine can accept the rest, push remainder to remaining_backlog
        if !fully_scheduled && item.quantity > 0 {
            remaining_backlog.push(item);
        }
    }

    let updated_machine_states: Vec<MachineState> = machine_states_map.into_values().collect();

    ScheduleResponse {
        newly_scheduled,
        remaining_backlog,
        updated_machine_states,
    }
}

#[tauri::command]
pub async fn auto_schedule(request: ScheduleRequest) -> Result<ScheduleResponse, String> {
    Ok(calculate_optimal_schedule(request))
}
