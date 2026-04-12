use serde::{Deserialize, Serialize};
//use std::fs::OpenOptions;
use std::path::Path;
use tiberius::{Client, Config, SqlBrowser};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::TokioAsyncWriteCompatExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScorecardRow {
    department: String,
    week_identifier: String,
    part_number: String,
    day_of_week: String,
    target: Option<i16>,
    actual: Option<i16>,
    date: Option<String>,
    shift: Option<String>,
    reason_code: Option<String>,
}

// Data models for MSSQL Preview based on provided schema
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocatorMapping {
    wip_locator: Option<String>,
    process: Option<String>,
    days_from_shipment: Option<i16>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartInfo {
    part_number: Option<String>,
    process: Option<String>,
    batch_size: Option<i16>,
    processing_time: Option<i16>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcessInfo {
    process: Option<String>,
    date: Option<String>,
    hours_available: Option<i16>,
    machine_id: Option<String>,
    shift: Option<String>,
    week_identifier: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PipelineRow {
    date: Option<String>,
    customer: Option<String>,
    customer_city: Option<String>,
    part_number: Option<String>,
    part_name: Option<String>,
    wip_locator: Option<String>,
    qty: Option<i16>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlanRow {
    pub date: Option<String>,
    pub part_number: Option<String>,
    pub part_name: Option<String>,
    pub process: Option<String>,
    pub qty: Option<i16>,
    pub actual: Option<i16>,
    pub shift: Option<String>,
    pub week_identifier: Option<String>,
    pub day_of_week: Option<String>,
    pub reason_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShiftProductionRecord {
    pub date: String,
    pub department: String,
    pub week_identifier: String,
    pub part_number: String,
    pub day_of_week: String,
    pub target: Option<i16>,
    pub actual: Option<i16>,
    pub shift: String,
    pub reason_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Process {
    pub process_name: String,
    pub machine_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReasonCodeData {
    pub process: Option<String>,
    pub reason_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DailyRateRow {
    pub part_number: Option<String>,
    pub week: i16,
    pub year: i16,
    pub qty: i16,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollingGapRow {
    pub part_number: String,
    pub shift: String,
    pub rolling_gap: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributeDemandRequest {
    pub total_demand: i32,
    pub child_rows: Vec<ChildRowDesc>,
    pub week_dates: Vec<Option<String>>, // YYYY-MM-DD
    pub anchor_dates: std::collections::HashMap<String, String>,
    pub shift_capacities: Vec<std::collections::HashMap<String, f64>>,
    pub processing_time_min: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildRowDesc {
    pub id: String,
    pub shift: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributeDemandResult {
    pub row_id: String,
    pub day: String,
    pub value: i32,
}

// State for managing the MSSQL connection status and settings
pub struct DbState {
    pub connection_string: Mutex<Option<String>>,
}

#[tauri::command]
async fn get_scorecard_data(connection_string: String) -> Result<Vec<ScorecardRow>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client.query(
        "SELECT Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, CONVERT(VARCHAR, Date, 23) as Date, Shift, ReasonCode FROM dbo.DeliveryData", 
        &[]
    ).await.map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| ScorecardRow {
            department: row
                .get::<&str, _>("Department")
                .unwrap_or_default()
                .trim()
                .to_string(),
            week_identifier: row
                .get::<&str, _>("WeekIdentifier")
                .unwrap_or_default()
                .trim()
                .to_string(),
            part_number: row
                .get::<&str, _>("PartNumber")
                .unwrap_or_default()
                .trim()
                .to_string(),
            day_of_week: row
                .get::<&str, _>("DayOfWeek")
                .unwrap_or_default()
                .trim()
                .to_string(),
            target: get_i16_robust(&row, "Target"),
            actual: get_i16_robust(&row, "Actual"),
            date: row.get::<&str, _>("Date").map(|s| s.trim().to_string()),
            shift: row.get::<&str, _>("Shift").map(|s| s.trim().to_string()),
            reason_code: row
                .get::<&str, _>("ReasonCode")
                .map(|s| s.trim().to_string()),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn get_rolling_gaps(
    connection_string: String,
    department: String,
) -> Result<Vec<RollingGapRow>, String> {
    let mut client = create_client(&connection_string).await?;
    let query = "
        WITH RankedGaps AS (
            SELECT 
                PartNumber,
                Shift,
                SUM(CAST(ISNULL(Actual, 0) AS INT) - CAST(ISNULL(Target, 0) AS INT)) OVER (PARTITION BY PartNumber, Shift ORDER BY Date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as RollingGap,
                ROW_NUMBER() OVER (PARTITION BY PartNumber, Shift ORDER BY Date DESC) as rn
            FROM dbo.DeliveryData
            WHERE Department = @p1 AND Date <= CAST(GETDATE() AS DATE)
        )
        SELECT PartNumber, Shift, RollingGap
        FROM RankedGaps
        WHERE rn = 1
    ";
    let stream = client.query(query, &[&department]).await.map_err(|e| e.to_string())?;
    let rows = stream.into_first_result().await.map_err(|e| e.to_string())?;

    let result = rows.into_iter().map(|row| RollingGapRow {
        part_number: row.get::<&str, _>("PartNumber").unwrap_or_default().trim().to_string(),
        shift: row.get::<&str, _>("Shift").unwrap_or_default().trim().to_string(),
        rolling_gap: row.get::<i32, _>("RollingGap").unwrap_or_default(),
    }).collect();

    Ok(result)
}

fn is_working_day(date_str: &str, anchor_date_str: &str) -> bool {
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
            true, true,          // Days 0, 1
            false, false,        // Days 2, 3
            true, true, true,    // Days 4, 5, 6
            false, false,        // Days 7, 8
            true, true,          // Days 9, 10
            false, false, false  // Days 11, 12, 13
        ];
        
        working_pattern[cycle_day as usize]
    } else {
        true
    }
}

#[tauri::command]
async fn calculate_demand_distribution(req: DistributeDemandRequest) -> Result<Vec<DistributeDemandResult>, String> {
    #[derive(Debug)]
    struct ValidSlot {
        row_id: String,
        day: String,
        day_idx: usize,
        shift: String,
        capacity: f64,
        base_assignment: i32,
    }

    let days_of_week = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let mut valid_slots: Vec<ValidSlot> = Vec::new();

    for (day_idx, day_name) in days_of_week.iter().enumerate() {
        if let Some(Some(date_str)) = req.week_dates.get(day_idx) {
            for part in &req.child_rows {
                let anchor_date = req.anchor_dates.get(&part.shift).map(|s| s.as_str()).unwrap_or("");
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
        let base = (req.total_demand as f64 * (slot.capacity / total_weekly_capacity)).floor() as i32;
        slot.base_assignment = base;
        assigned_count += base;
    }

    let mut remainder = req.total_demand - assigned_count;

    if remainder > 0 {
        valid_slots.sort_by(|a, b| {
            let unused_a = a.capacity - ((a.base_assignment as f64 * req.processing_time_min) / 60.0);
            let unused_b = b.capacity - ((b.base_assignment as f64 * req.processing_time_min) / 60.0);
            unused_b.partial_cmp(&unused_a).unwrap_or(std::cmp::Ordering::Equal)
        });

        let mut i = 0;
        let len = valid_slots.len();
        while remainder > 0 {
            valid_slots[i % len].base_assignment += 1;
            remainder -= 1;
            i += 1;
        }
    }

    let result = valid_slots.into_iter().map(|slot| DistributeDemandResult {
        row_id: slot.row_id,
        day: slot.day,
        value: slot.base_assignment,
    }).collect();

    Ok(result)
}

#[tauri::command]
async fn upsert_scorecard_data(
    connection_string: String,
    records: Vec<ScorecardRow>,
) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }

    let mut client = create_client(&connection_string).await?;
    
    // Start transaction
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    // Create a temporary table
    let create_temp_sql = "
        CREATE TABLE #TempDeliveryData (
            Department NVARCHAR(50),
            WeekIdentifier NVARCHAR(50),
            PartNumber NVARCHAR(50),
            DayOfWeek NVARCHAR(50),
            Target SMALLINT,
            Actual SMALLINT,
            Date DATE,
            Shift NVARCHAR(50),
            ReasonCode NVARCHAR(50)
        )
    ";
    
    client.simple_query(create_temp_sql).await.map_err(|e| e.to_string())?;

    // Insert into temp table in batches to respect 2000 param limit
    let chunk_size = 200; // 9 params * 200 = 1800 params < 2000
    for chunk in records.chunks(chunk_size) {
        let mut sql = String::from("INSERT INTO #TempDeliveryData (Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, Date, Shift, ReasonCode) VALUES ");
        let mut params: Vec<&dyn tiberius::ToSql> = Vec::new();
        let mut param_idx = 1;
        
        for (i, rec) in chunk.iter().enumerate() {
            if i > 0 {
                sql.push_str(", ");
            }
            sql.push_str(&format!(
                "(@p{}, @p{}, @p{}, @p{}, @p{}, @p{}, CAST(@p{} AS DATE), @p{}, @p{})",
                param_idx, param_idx+1, param_idx+2, param_idx+3, param_idx+4, param_idx+5, param_idx+6, param_idx+7, param_idx+8
            ));
            param_idx += 9;
            
            params.push(&rec.department);
            params.push(&rec.week_identifier);
            params.push(&rec.part_number);
            params.push(&rec.day_of_week);
            params.push(&rec.target);
            params.push(&rec.actual);
            params.push(&rec.date);
            params.push(&rec.shift);
            params.push(&rec.reason_code);
        }
        
        client.execute(&sql, &params).await.map_err(|e| e.to_string())?;
    }

    // Perform bulk MERGE
    let merge_sql = "
        MERGE dbo.DeliveryData AS target
        USING #TempDeliveryData AS source
        ON (target.Department = source.Department 
            AND target.PartNumber = source.PartNumber 
            AND target.Date = source.Date 
            AND (target.Shift = source.Shift OR (target.Shift IS NULL AND source.Shift IS NULL)))
        WHEN MATCHED THEN
            UPDATE SET 
                Target = source.Target, 
                Actual = source.Actual, 
                WeekIdentifier = source.WeekIdentifier, 
                DayOfWeek = source.DayOfWeek, 
                ReasonCode = source.ReasonCode
        WHEN NOT MATCHED THEN
            INSERT (Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, Date, Shift, ReasonCode)
            VALUES (source.Department, source.WeekIdentifier, source.PartNumber, source.DayOfWeek, source.Target, source.Actual, source.Date, source.Shift, source.ReasonCode);
    ";

    client.execute(merge_sql, &[]).await.map_err(|e| e.to_string())?;

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn replace_delivery_data(
    connection_string: String,
    records: Vec<ScorecardRow>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    client
        .execute("DELETE FROM dbo.DeliveryData", &[])
        .await
        .map_err(|e| e.to_string())?;

    let create_temp_sql = "
        CREATE TABLE #TempDeliveryData (
            Department NVARCHAR(50),
            WeekIdentifier NVARCHAR(50),
            PartNumber NVARCHAR(50),
            DayOfWeek NVARCHAR(50),
            Target SMALLINT,
            Actual SMALLINT,
            Date DATE,
            Shift NVARCHAR(50),
            ReasonCode NVARCHAR(50)
        )
    ";
    
    client.simple_query(create_temp_sql).await.map_err(|e| e.to_string())?;

    let chunk_size = 200;
    for chunk in records.chunks(chunk_size) {
        let mut sql = String::from("INSERT INTO #TempDeliveryData (Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, Date, Shift, ReasonCode) VALUES ");
        let mut params: Vec<&dyn tiberius::ToSql> = Vec::new();
        let mut param_idx = 1;
        
        for (i, rec) in chunk.iter().enumerate() {
            if i > 0 {
                sql.push_str(", ");
            }
            sql.push_str(&format!(
                "(@p{}, @p{}, @p{}, @p{}, @p{}, @p{}, CAST(@p{} AS DATE), @p{}, @p{})",
                param_idx, param_idx+1, param_idx+2, param_idx+3, param_idx+4, param_idx+5, param_idx+6, param_idx+7, param_idx+8
            ));
            param_idx += 9;
            
            params.push(&rec.department);
            params.push(&rec.week_identifier);
            params.push(&rec.part_number);
            params.push(&rec.day_of_week);
            params.push(&rec.target);
            params.push(&rec.actual);
            params.push(&rec.date);
            params.push(&rec.shift);
            params.push(&rec.reason_code);
        }
        
        client.execute(&sql, &params).await.map_err(|e| e.to_string())?;
    }

    let insert_sql = "
        INSERT INTO dbo.DeliveryData (Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, Date, Shift, ReasonCode)
        SELECT Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, Date, Shift, ReasonCode
        FROM #TempDeliveryData
    ";

    client.execute(insert_sql, &[]).await.map_err(|e| e.to_string())?;

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn delete_scorecard_week(
    connection_string: String,
    department: String,
    week_identifier: String,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .execute(
            "DELETE FROM dbo.DeliveryData WHERE Department = @p1 AND WeekIdentifier = @p2",
            &[&department, &week_identifier],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_scorecard_row(
    connection_string: String,
    department: String,
    week_identifier: String,
    part_number: String,
    shift: String,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .execute(
            "DELETE FROM dbo.DeliveryData 
             WHERE Department = @p1 
               AND WeekIdentifier = @p2 
               AND PartNumber = @p3 
               AND (Shift = @p4 OR (Shift IS NULL AND @p4 = ''))",
            &[&department, &week_identifier, &part_number, &shift],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn create_client(
    connection_string: &str,
) -> Result<Client<tokio_util::compat::Compat<TcpStream>>, String> {
    let config = Config::from_ado_string(connection_string)
        .map_err(|e| format!("Invalid connection string: {}", e))?;
    let tcp = TcpStream::connect_named(&config)
        .await
        .map_err(|e| format!("Failed to connect to TCP socket: {}", e))?;
    tcp.set_nodelay(true)
        .map_err(|e| format!("Failed to set TCP nodelay: {}", e))?;
    let client = Client::connect(config, tcp.compat_write())
        .await
        .map_err(|e| format!("Failed to authenticate with MSSQL server: {:?}", e))?;
    Ok(client)
}

fn get_i16_robust(row: &tiberius::Row, col: &str) -> Option<i16> {
    if let Ok(val) = row.try_get::<i16, _>(col) {
        return val;
    }
    if let Ok(val) = row.try_get::<i32, _>(col) {
        return val.map(|v| v as i16);
    }
    if let Ok(val) = row.try_get::<f64, _>(col) {
        return val.map(|v| v as i16);
    }
    if let Ok(val) = row.try_get::<&str, _>(col) {
        return val.and_then(|s| s.trim().parse::<i16>().ok());
    }
    None
}

#[tauri::command]
async fn test_mssql_connection(connection_string: String) -> Result<String, String> {
    let mut client = create_client(&connection_string).await?;
    let _row: Option<tiberius::Row> = client
        .query("SELECT 1", &[])
        .await
        .map_err(|e| format!("Failed to execute query: {:?}", e))?
        .into_row()
        .await
        .map_err(|e| format!("Failed to read row: {:?}", e))?;
    Ok("Successfully connected to MSSQL!".to_string())
}

#[tauri::command]
async fn get_locator_mapping_preview(
    connection_string: String,
) -> Result<Vec<LocatorMapping>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client
        .query(
            "SELECT TOP 100 WIPLocator, ProcessName, DaysFromShipment FROM dbo.LocatorMapping",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| LocatorMapping {
            wip_locator: row
                .get::<&str, _>("WIPLocator")
                .map(|s| s.trim().to_string()),
            process: row.get::<&str, _>("ProcessName").map(|s| s.trim().to_string()),
            days_from_shipment: get_i16_robust(&row, "DaysFromShipment"),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn get_part_info_preview(connection_string: String) -> Result<Vec<PartInfo>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client
        .query(
            "SELECT TOP 1000 PartNumber, ProcessName, BatchSize, ProcessingTime FROM dbo.PartInfo",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| PartInfo {
            part_number: row
                .get::<&str, _>("PartNumber")
                .map(|s| s.trim().to_string()),
            process: row.get::<&str, _>("ProcessName").map(|s| s.trim().to_string()),
            batch_size: get_i16_robust(&row, "BatchSize"),
            processing_time: get_i16_robust(&row, "ProcessingTime"),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn get_process_info_preview(connection_string: String) -> Result<Vec<ProcessInfo>, String> {
    let mut client = create_client(&connection_string).await?;
    // Formatted date to string for simple transfer
    let stream = client.query("SELECT TOP 1000 ProcessName, CONVERT(VARCHAR, Date, 23) as Date, HoursAvailable, MachineID, Shift, WeekIdentifier FROM dbo.ProcessInfo", &[]).await.map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| ProcessInfo {
            process: row.get::<&str, _>("ProcessName").map(|s| s.trim().to_string()),
            date: row.get::<&str, _>("Date").map(|s| s.trim().to_string()),
            hours_available: get_i16_robust(&row, "HoursAvailable"),
            machine_id: row
                .get::<&str, _>("MachineID")
                .map(|s| s.trim().to_string()),
            shift: row.get::<&str, _>("Shift").map(|s| s.trim().to_string()),
            week_identifier: row
                .get::<&str, _>("WeekIdentifier")
                .map(|s| s.trim().to_string()),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn get_process_info(
    connection_string: String,
    process: String,
    week_identifier: String,
) -> Result<Vec<ProcessInfo>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client.query(
        "SELECT ProcessName, CONVERT(VARCHAR, Date, 23) as Date, HoursAvailable, MachineID, Shift, WeekIdentifier 
         FROM dbo.ProcessInfo 
         WHERE ProcessName = @p1 
           AND WeekIdentifier = @p2",
        &[&process, &week_identifier],
    ).await.map_err(|e| e.to_string())?;

    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| ProcessInfo {
            process: row.get::<&str, _>("ProcessName").map(|s| s.trim().to_string()),
            date: row.get::<&str, _>("Date").map(|s| s.trim().to_string()),
            hours_available: get_i16_robust(&row, "HoursAvailable"),
            machine_id: row
                .get::<&str, _>("MachineID")
                .map(|s| s.trim().to_string()),
            shift: row.get::<&str, _>("Shift").map(|s| s.trim().to_string()),
            week_identifier: row
                .get::<&str, _>("WeekIdentifier")
                .map(|s| s.trim().to_string()),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn get_pipeline_data_preview(connection_string: String) -> Result<Vec<PipelineRow>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client.query("SELECT TOP 500 CONVERT(VARCHAR, Date, 23) as Date, Customer, CustomerCity, PartNumber, PartName, WIPLocator, Qty FROM dbo.PipelineData", &[]).await.map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| PipelineRow {
            date: row.get::<&str, _>("Date").map(|s| s.trim().to_string()),
            customer: row.get::<&str, _>("Customer").map(|s| s.trim().to_string()),
            customer_city: row
                .get::<&str, _>("CustomerCity")
                .map(|s| s.trim().to_string()),
            part_number: row
                .get::<&str, _>("PartNumber")
                .map(|s| s.trim().to_string()),
            part_name: row.get::<&str, _>("PartName").map(|s| s.trim().to_string()),
            wip_locator: row
                .get::<&str, _>("WIPLocator")
                .map(|s| s.trim().to_string()),
            qty: get_i16_robust(&row, "Qty"),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn get_plan_data_preview(connection_string: String) -> Result<Vec<PlanRow>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client.query("SELECT TOP 500 CONVERT(VARCHAR, Date, 23) as Date, PartNumber, '' as PartName, Department as ProcessName, Target as Qty, Actual, ReasonCode, Shift, WeekIdentifier, DayOfWeek FROM dbo.DeliveryData", &[]).await.map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| PlanRow {
            date: row.get::<&str, _>("Date").map(|s| s.trim().to_string()),
            part_number: row
                .get::<&str, _>("PartNumber")
                .map(|s| s.trim().to_string()),
            part_name: Some("".to_string()),
            process: row.get::<&str, _>("ProcessName").map(|s| s.trim().to_string()),
            qty: get_i16_robust(&row, "Qty"),
            actual: get_i16_robust(&row, "Actual"),
            shift: row.get::<&str, _>("Shift").map(|s| s.trim().to_string()),
            week_identifier: row
                .get::<&str, _>("WeekIdentifier")
                .map(|s| s.trim().to_string()),
            day_of_week: row
                .get::<&str, _>("DayOfWeek")
                .map(|s| s.trim().to_string()),
            reason_code: row
                .get::<&str, _>("ReasonCode")
                .map(|s| s.trim().to_string()),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn append_pipeline_data(
    connection_string: String,
    records: Vec<PipelineRow>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    for mut rec in records {
        if let Some(ref mut locator) = rec.wip_locator {
            *locator = locator.to_uppercase();
        }
        client.execute(
            "INSERT INTO dbo.PipelineData (Date, Customer, CustomerCity, PartNumber, PartName, WIPLocator, Qty) 
             VALUES (CAST(@p1 as DATE), @p2, @p3, @p4, @p5, @p6, @p7)",
            &[&rec.date, &rec.customer, &rec.customer_city, &rec.part_number, &rec.part_name, &rec.wip_locator, &rec.qty],
        ).await.map_err(|e| e.to_string())?;
    }

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_pipeline_data_by_date(
    connection_string: String,
    date: String,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .execute(
            "DELETE FROM dbo.PipelineData WHERE Date = CAST(@p1 as DATE)",
            &[&date],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn append_plan_data(connection_string: String, records: Vec<PlanRow>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    for rec in records {
        client
            .execute(
                "INSERT INTO dbo.DeliveryData (Date, Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Shift) 
             VALUES (CAST(@p1 as DATE), @p2, @p3, @p4, @p5, @p6, @p7)",
                &[
                    &rec.date,
                    &rec.process,
                    &rec.week_identifier,
                    &rec.part_number,
                    &rec.day_of_week,
                    &rec.qty,
                    &rec.shift,
                ],
            )
            .await
            .map_err(|e| e.to_string())?;
    }

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_plan_data_by_date(connection_string: String, date: String) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .execute(
            "DELETE FROM dbo.DeliveryData WHERE Date = CAST(@p1 as DATE)",
            &[&date],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_plan_data_for_shift(
    connection_string: String,
    date: String,
    process: String,
    shift: String,
) -> Result<Vec<PlanRow>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client
        .query(
            "SELECT PartNumber, '' as PartName, Department as ProcessName, Target as Qty, Actual, ReasonCode, CONVERT(VARCHAR, Date, 23) as Date, Shift, WeekIdentifier, DayOfWeek 
         FROM dbo.DeliveryData 
         WHERE Date = CAST(@p1 AS DATE) 
           AND Department = @p2 
           AND (Shift = @p3 OR Shift IS NULL)",
            &[&date, &process, &shift],
        )
        .await
        .map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| PlanRow {
            date: row.get::<&str, _>("Date").map(|s| s.trim().to_string()),
            part_number: row
                .get::<&str, _>("PartNumber")
                .map(|s| s.trim().to_string()),
            part_name: Some("".to_string()),
            process: row.get::<&str, _>("ProcessName").map(|s| s.trim().to_string()),
            qty: get_i16_robust(&row, "Qty"),
            actual: get_i16_robust(&row, "Actual"),
            shift: row.get::<&str, _>("Shift").map(|s| s.trim().to_string()),
            week_identifier: row
                .get::<&str, _>("WeekIdentifier")
                .map(|s| s.trim().to_string()),
            day_of_week: row
                .get::<&str, _>("DayOfWeek")
                .map(|s| s.trim().to_string()),
            reason_code: row
                .get::<&str, _>("ReasonCode")
                .map(|s| s.trim().to_string()),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn get_all_part_numbers(connection_string: String) -> Result<Vec<String>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client.query(
        "SELECT DISTINCT PartNumber FROM dbo.PartInfo WHERE PartNumber IS NOT NULL ORDER BY PartNumber",
        &[],
    ).await.map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .filter_map(|row| {
            row.get::<&str, _>("PartNumber")
                .map(|s| s.trim().to_string())
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn get_part_numbers_by_process(
    connection_string: String,
    process: String,
) -> Result<Vec<String>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client.query(
        "SELECT DISTINCT PartNumber FROM dbo.PartInfo WHERE ProcessName = @p1 AND PartNumber IS NOT NULL ORDER BY PartNumber",
        &[&process],
    ).await.map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .filter_map(|row| {
            row.get::<&str, _>("PartNumber")
                .map(|s| s.trim().to_string())
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn get_reason_codes_by_process(
    connection_string: String,
    process: String,
) -> Result<Vec<String>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client.query(
        "SELECT DISTINCT ReasonCode FROM dbo.ReasonCode WHERE ProcessName = @p1 AND ReasonCode IS NOT NULL ORDER BY ReasonCode",
        &[&process],
    ).await.map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .filter_map(|row| {
            row.get::<&str, _>("ReasonCode")
                .map(|s| s.trim().to_string())
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn submit_shift_production(
    connection_string: String,
    records: Vec<ShiftProductionRecord>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    for rec in records {
        client.execute(
            "MERGE dbo.DeliveryData AS target
             USING (SELECT @p1 as Department, @p2 as WeekIdentifier, @p3 as PartNumber, @p4 as DayOfWeek, 
                           @p5 as Target, @p6 as Actual, CAST(@p7 as DATE) as Date, @p8 as Shift, @p9 as ReasonCode) AS source
             ON (target.Department = source.Department AND target.PartNumber = source.PartNumber 
                 AND target.Date = source.Date AND (target.Shift = source.Shift OR (target.Shift IS NULL AND source.Shift IS NULL)))
             WHEN MATCHED THEN
                UPDATE SET Target = source.Target, Actual = source.Actual, WeekIdentifier = source.WeekIdentifier, 
                           DayOfWeek = source.DayOfWeek, ReasonCode = source.ReasonCode
             WHEN NOT MATCHED THEN
                INSERT (Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, Date, Shift, ReasonCode)
                VALUES (source.Department, source.WeekIdentifier, source.PartNumber, source.DayOfWeek, 
                        source.Target, source.Actual, source.Date, source.Shift, source.ReasonCode);",
            &[&rec.department, &rec.week_identifier, &rec.part_number, &rec.day_of_week,
              &rec.target, &rec.actual, &rec.date, &rec.shift, &rec.reason_code],
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
async fn parse_and_transpose_pipeline_csv(file_path: String) -> Result<Vec<PipelineRow>, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(path)
        .map_err(|e| e.to_string())?;

    let headers = rdr.headers().map_err(|e| e.to_string())?.clone();

    // Identify fixed columns with case-insensitive matching
    let fixed_match = |h: &str| -> Option<&'static str> {
        let h_lower = h.to_lowercase();
        if h_lower == "date" {
            Some("Date")
        } else if h_lower == "customer" {
            Some("Customer")
        } else if h_lower == "customer city" || h_lower == "customercity" {
            Some("Customer City")
        } else if h_lower == "part number" || h_lower == "partnumber" {
            Some("Part Number")
        } else if h_lower == "part name" || h_lower == "partname" {
            Some("Part Name")
        } else if h_lower == "wiplocator" || h_lower == "wip locator" {
            Some("WIP Locator")
        } else if h_lower == "qty" {
            Some("Qty")
        } else {
            None
        }
    };

    // Map positional indices of fixed columns
    let find_idx = |target: &str| headers.iter().position(|h| fixed_match(h) == Some(target));
    let date_idx = find_idx("Date");
    let customer_idx = find_idx("Customer");
    let city_idx = find_idx("Customer City");
    let part_idx = find_idx("Part Number");
    let name_idx = find_idx("Part Name");
    let wip_col_idx = find_idx("WIP Locator");
    let qty_col_idx = find_idx("Qty");

    let is_long_format = wip_col_idx.is_some() && qty_col_idx.is_some();

    // If not long format, find WIP Locators: anything that doesn't match a fixed column
    let mut wip_locator_cols = Vec::new();
    if !is_long_format {
        for (i, header) in headers.iter().enumerate() {
            if fixed_match(header).is_none() {
                wip_locator_cols.push((i, header.to_string()));
            }
        }
    }

    let mut transposed = Vec::new();

    for result in rdr.records() {
        let record = result.map_err(|e| e.to_string())?;

        // Extract fixed values
        let date_val = date_idx.and_then(|i| record.get(i)).map(|s| s.to_string());
        let customer_val = customer_idx
            .and_then(|i| record.get(i))
            .map(|s| s.to_string());
        let city_val = city_idx.and_then(|i| record.get(i)).map(|s| s.to_string());
        let part_val = part_idx.and_then(|i| record.get(i)).map(|s| s.to_string());

        // PartName logic: use CSV value if exists, else first 7 of PartNumber
        let part_name_val = if let Some(idx) = name_idx {
            record.get(idx).map(|s| s.to_string()).unwrap_or_default()
        } else {
            part_val
                .as_ref()
                .map(|p| {
                    if p.len() >= 7 {
                        p[..7].to_string()
                    } else {
                        p.clone()
                    }
                })
                .unwrap_or_default()
        };

        if is_long_format {
            // Process as long format
            let locator_name = wip_col_idx
                .and_then(|i| record.get(i))
                .map(|s| s.to_string())
                .unwrap_or_default();
            let qty_str = qty_col_idx.and_then(|i| record.get(i)).unwrap_or("0");
            let qty = qty_str.trim().parse::<f64>().unwrap_or(0.0) as i16;

            if qty > 0 && !locator_name.is_empty() {
                transposed.push(PipelineRow {
                    date: date_val.clone(),
                    customer: customer_val.clone(),
                    customer_city: city_val.clone(),
                    part_number: part_val.clone(),
                    part_name: Some(part_name_val.clone()),
                    wip_locator: Some(locator_name.to_uppercase()),
                    qty: Some(qty),
                });
            }
        } else {
            // Process as wide format (transpose)
            for (pos, locator_name) in &wip_locator_cols {
                if let Some(qty_str) = record.get(*pos) {
                    if !qty_str.is_empty() {
                        let qty = qty_str.trim().parse::<f64>().unwrap_or(0.0) as i16;
                        if qty > 0 {
                            transposed.push(PipelineRow {
                                date: date_val.clone(),
                                customer: customer_val.clone(),
                                customer_city: city_val.clone(),
                                part_number: part_val.clone(),
                                part_name: Some(part_name_val.clone()),
                                wip_locator: Some(locator_name.to_uppercase()),
                                qty: Some(qty),
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(transposed)
}

#[tauri::command]
async fn sync_pipeline_locators(connection_string: String) -> Result<u64, String> {
    let mut client = create_client(&connection_string).await?;
    let res = client.execute(
        "INSERT INTO dbo.LocatorMapping (WIPLocator)
         SELECT DISTINCT UPPER(WIPLocator)
         FROM dbo.PipelineData
         WHERE WIPLocator IS NOT NULL 
           AND UPPER(WIPLocator) NOT IN (SELECT WIPLocator FROM dbo.LocatorMapping WHERE WIPLocator IS NOT NULL)",
        &[],
    ).await.map_err(|e| e.to_string())?;

    Ok(res.total())
}

#[tauri::command]
async fn upsert_locator_mapping(
    connection_string: String,
    records: Vec<LocatorMapping>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for mut rec in records {
        if let Some(ref mut locator) = rec.wip_locator {
            *locator = locator.to_uppercase();
        }
        client
            .execute(
                "MERGE dbo.LocatorMapping AS target
             USING (SELECT @p1 as WIPLocator, @p2 as ProcessName, @p3 as DaysFromShipment) AS source
             ON (target.WIPLocator = source.WIPLocator)
             WHEN MATCHED THEN
                UPDATE SET ProcessName = source.ProcessName, DaysFromShipment = source.DaysFromShipment
             WHEN NOT MATCHED THEN
                INSERT (WIPLocator, ProcessName, DaysFromShipment)
                VALUES (source.WIPLocator, source.ProcessName, source.DaysFromShipment);",
                &[&rec.wip_locator, &rec.process, &rec.days_from_shipment],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn upsert_part_info(connection_string: String, records: Vec<PartInfo>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        client.execute(
            "MERGE dbo.PartInfo AS target
             USING (SELECT @p1 as PartNumber, @p2 as ProcessName, @p3 as BatchSize, @p4 as ProcessingTime) AS source
             ON (target.PartNumber = source.PartNumber AND target.ProcessName = source.ProcessName)
             WHEN MATCHED THEN
                UPDATE SET BatchSize = source.BatchSize, ProcessingTime = source.ProcessingTime
             WHEN NOT MATCHED THEN
                INSERT (PartNumber, ProcessName, BatchSize, ProcessingTime)
                VALUES (source.PartNumber, source.ProcessName, source.BatchSize, source.ProcessingTime);",
            &[&rec.part_number, &rec.process, &rec.batch_size, &rec.processing_time],
        ).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn upsert_process_info(
    connection_string: String,
    records: Vec<ProcessInfo>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        let mid = rec.machine_id.clone().unwrap_or_default();
        let week = rec.week_identifier.clone().unwrap_or_default();
        client.execute(
            "MERGE dbo.ProcessInfo AS target
             USING (SELECT @p1 as ProcessName, CAST(@p2 as DATE) as Date, @p3 as HoursAvailable, @p4 as MachineID, @p5 as Shift, @p6 as WeekIdentifier) AS source
             ON (target.ProcessName = source.ProcessName AND target.Date = source.Date AND target.MachineID = source.MachineID AND target.Shift = source.Shift AND target.WeekIdentifier = source.WeekIdentifier)
             WHEN MATCHED THEN
                UPDATE SET HoursAvailable = source.HoursAvailable
             WHEN NOT MATCHED THEN
                INSERT (ProcessName, Date, HoursAvailable, MachineID, Shift, WeekIdentifier)
                VALUES (source.ProcessName, source.Date, source.HoursAvailable, source.MachineID, source.Shift, source.WeekIdentifier);",
            &[&rec.process, &rec.date, &rec.hours_available, &mid, &rec.shift, &week],
        ).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn delete_locator_mappings(
    connection_string: String,
    wip_locators: Vec<String>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for id in wip_locators {
        client
            .execute(
                "DELETE FROM dbo.LocatorMapping WHERE WIPLocator = @p1",
                &[&id.to_uppercase()],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct PartInfoId {
    part_number: String,
    process: String,
}

#[tauri::command]
async fn delete_part_infos(
    connection_string: String,
    identifiers: Vec<PartInfoId>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for id in identifiers {
        client
            .execute(
                "DELETE FROM dbo.PartInfo WHERE PartNumber = @p1 AND ProcessName = @p2",
                &[&id.part_number, &id.process],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct ProcessInfoId {
    process: Option<String>,
    date: Option<String>,
    machine_id: Option<String>,
    shift: Option<String>,
}

#[tauri::command]
async fn delete_process_infos(
    connection_string: String,
    identifiers: Vec<ProcessInfoId>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for id in identifiers {
        client
            .execute(
                "DELETE FROM dbo.ProcessInfo 
             WHERE ISNULL(ProcessName, '') = ISNULL(@p1, '') 
               AND Date = CAST(@p2 as DATE) 
               AND ISNULL(MachineID, '') = ISNULL(@p3, '')
               AND ISNULL(Shift, '') = ISNULL(@p4, '')",
                &[&id.process, &id.date, &id.machine_id, &id.shift],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn replace_locator_mappings(
    connection_string: String,
    records: Vec<LocatorMapping>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    // Clear and re-populate
    client
        .execute("DELETE FROM dbo.LocatorMapping", &[])
        .await
        .map_err(|e| e.to_string())?;
    for mut rec in records {
        if let Some(ref mut locator) = rec.wip_locator {
            *locator = locator.to_uppercase();
        }
        client.execute(
            "INSERT INTO dbo.LocatorMapping (WIPLocator, ProcessName, DaysFromShipment) VALUES (@p1, @p2, @p3)",
            &[&rec.wip_locator, &rec.process, &rec.days_from_shipment],
        ).await.map_err(|e| e.to_string())?;
    }

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn replace_part_infos(
    connection_string: String,
    records: Vec<PartInfo>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    client
        .execute("DELETE FROM dbo.PartInfo", &[])
        .await
        .map_err(|e| e.to_string())?;
    for rec in records {
        client.execute(
            "INSERT INTO dbo.PartInfo (PartNumber, ProcessName, BatchSize, ProcessingTime) VALUES (@p1, @p2, @p3, @p4)",
            &[&rec.part_number, &rec.process, &rec.batch_size, &rec.processing_time],
        ).await.map_err(|e| e.to_string())?;
    }

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn replace_process_infos(
    connection_string: String,
    records: Vec<ProcessInfo>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    client
        .execute("DELETE FROM dbo.ProcessInfo", &[])
        .await
        .map_err(|e| e.to_string())?;
    for rec in records {
        let mid = rec.machine_id.unwrap_or_default();
        client.execute(
            "INSERT INTO dbo.ProcessInfo (ProcessName, Date, HoursAvailable, MachineID, Shift, WeekIdentifier) 
             VALUES (@p1, CAST(@p2 as DATE), @p3, @p4, @p5, @p6)",
            &[&rec.process, &rec.date, &rec.hours_available, &mid, &rec.shift, &rec.week_identifier],
        ).await.map_err(|e| e.to_string())?;
    }

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_daily_rate_preview(connection_string: String) -> Result<Vec<DailyRateRow>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client
        .query(
            "SELECT TOP 1000 PartNumber, Week, Year, Qty FROM dbo.DailyRate",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| DailyRateRow {
            part_number: row
                .get::<&str, _>("PartNumber")
                .map(|s| s.trim().to_string()),
            week: get_i16_robust(&row, "Week").unwrap_or(0),
            year: get_i16_robust(&row, "Year").unwrap_or(0),
            qty: get_i16_robust(&row, "Qty").unwrap_or(0),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn upsert_daily_rate(
    connection_string: String,
    records: Vec<DailyRateRow>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        client.execute(
            "MERGE dbo.DailyRate AS target
             USING (SELECT @p1 as PartNumber, @p2 as Week, @p3 as Year, @p4 as Qty) AS source
             ON (LTRIM(RTRIM(target.PartNumber)) = LTRIM(RTRIM(source.PartNumber)) AND target.Week = source.Week AND target.Year = source.Year)
             WHEN MATCHED THEN
                UPDATE SET Qty = source.Qty
             WHEN NOT MATCHED THEN
                INSERT (PartNumber, Week, Year, Qty)
                VALUES (source.PartNumber, source.Week, source.Year, source.Qty);",
            &[&rec.part_number, &rec.week, &rec.year, &rec.qty],
        ).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn delete_daily_rates(
    connection_string: String,
    records: Vec<DailyRateRow>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        client.execute(
            "DELETE FROM dbo.DailyRate WHERE LTRIM(RTRIM(PartNumber)) = LTRIM(RTRIM(@p1)) AND Week = @p2 AND Year = @p3",
            &[&rec.part_number, &rec.week, &rec.year],
        ).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn replace_daily_rates(
    connection_string: String,
    records: Vec<DailyRateRow>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    client
        .execute("DELETE FROM dbo.DailyRate", &[])
        .await
        .map_err(|e| e.to_string())?;
    for rec in records {
        client.execute(
            "INSERT INTO dbo.DailyRate (PartNumber, Week, Year, Qty) VALUES (@p1, @p2, @p3, @p4)",
            &[&rec.part_number, &rec.week, &rec.year, &rec.qty],
        ).await.map_err(|e| e.to_string())?;
    }

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_processes_preview(connection_string: String) -> Result<Vec<Process>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client
        .query("SELECT ProcessName, MachineID FROM dbo.Process", &[])
        .await
        .map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| Process {
            process_name: row
                .get::<&str, _>("ProcessName")
                .unwrap_or_default()
                .trim()
                .to_string(),
            machine_id: row.get::<&str, _>("MachineID").map(|s| s.trim().to_string()),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn upsert_process(connection_string: String, records: Vec<Process>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        let machine_id = rec.machine_id.unwrap_or_default();
        client
            .execute(
                "MERGE dbo.Process AS target
             USING (SELECT @p1 as ProcessName, @p2 as MachineID) AS source
             ON (target.ProcessName = source.ProcessName AND target.MachineID = source.MachineID)
             WHEN MATCHED THEN
                UPDATE SET MachineID = source.MachineID
             WHEN NOT MATCHED THEN
                INSERT (ProcessName, MachineID) VALUES (source.ProcessName, source.MachineID);",
                &[&rec.process_name, &machine_id],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn delete_processes(
    connection_string: String,
    records: Vec<Process>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        let machine_id = rec.machine_id.unwrap_or_default();
        client
            .execute(
                "DELETE FROM dbo.Process WHERE ProcessName = @p1 AND MachineID = @p2",
                &[&rec.process_name, &machine_id],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn replace_processes(connection_string: String, records: Vec<Process>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    client
        .execute("DELETE FROM dbo.Process", &[])
        .await
        .map_err(|e| e.to_string())?;
    for rec in records {
        let machine_id = rec.machine_id.unwrap_or_default();
        client
            .execute(
                "INSERT INTO dbo.Process (ProcessName, MachineID) VALUES (@p1, @p2)",
                &[&rec.process_name, &machine_id],
            )
            .await
            .map_err(|e| e.to_string())?;
    }

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_reason_codes_preview(
    connection_string: String,
) -> Result<Vec<ReasonCodeData>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client
        .query(
            "SELECT TOP 1000 ProcessName, ReasonCode FROM dbo.ReasonCode",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| ReasonCodeData {
            process: row.get::<&str, _>("ProcessName").map(|s| s.trim().to_string()),
            reason_code: row
                .get::<&str, _>("ReasonCode")
                .map(|s| s.trim().to_string()),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn upsert_reason_codes(
    connection_string: String,
    records: Vec<ReasonCodeData>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        client.execute(
            "MERGE dbo.ReasonCode AS target
             USING (SELECT @p1 as ProcessName, @p2 as ReasonCode) AS source
             ON (target.ProcessName = source.ProcessName AND target.ReasonCode = source.ReasonCode)
             WHEN NOT MATCHED THEN
                INSERT (ProcessName, ReasonCode) VALUES (source.ProcessName, source.ReasonCode);",
            &[&rec.process, &rec.reason_code]
        ).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn delete_reason_codes(
    connection_string: String,
    records: Vec<ReasonCodeData>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        client.execute(
            "DELETE FROM dbo.ReasonCode WHERE ProcessName = @p1 AND ReasonCode = @p2",
            &[&rec.process, &rec.reason_code]
        ).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn replace_reason_codes(
    connection_string: String,
    records: Vec<ReasonCodeData>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    client
        .execute("DELETE FROM dbo.ReasonCode", &[])
        .await
        .map_err(|e| e.to_string())?;

    for rec in records {
        client
            .execute(
                "INSERT INTO dbo.ReasonCode (ProcessName, ReasonCode) VALUES (@p1, @p2)",
                &[&rec.process, &rec.reason_code],
            )
            .await
            .map_err(|e| e.to_string())?;
    }

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_machines_by_process(
    connection_string: String,
    process: String,
) -> Result<Vec<String>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client
        .query(
            "SELECT DISTINCT MachineID 
         FROM dbo.Process 
         WHERE ProcessName = @p1 
           AND MachineID IS NOT NULL 
         ORDER BY MachineID",
            &[&process],
        )
        .await
        .map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .filter_map(|row| row.get::<&str, _>("MachineID").map(|s| s.trim().to_string()))
        .collect();

    Ok(result)
}

#[tauri::command]
async fn get_processes(connection_string: String) -> Result<Vec<String>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client
        .query("SELECT DISTINCT ProcessName FROM dbo.Process WHERE ProcessName IS NOT NULL ORDER BY ProcessName", &[])
        .await
        .map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .filter_map(|row| row.get::<&str, _>("ProcessName").map(|s| s.trim().to_string()))
        .collect();

    Ok(result)
}

#[tauri::command]
async fn get_active_weeks(connection_string: String) -> Result<Vec<String>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client
        .query("SELECT DISTINCT WeekIdentifier FROM dbo.ProcessInfo WHERE WeekIdentifier IS NOT NULL ORDER BY WeekIdentifier DESC", &[])
        .await
        .map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .filter_map(|row| {
            row.get::<&str, _>("WeekIdentifier")
                .map(|s| s.trim().to_string())
        })
        .collect();

    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DbState {
            connection_string: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_scorecard_data,
            upsert_scorecard_data,
            replace_delivery_data,
            delete_scorecard_week,
            delete_scorecard_row,
            test_mssql_connection,
            get_locator_mapping_preview,
            get_part_info_preview,
            get_process_info_preview,
            get_process_info,
            get_pipeline_data_preview,
            upsert_locator_mapping,
            upsert_part_info,
            upsert_process_info,
            delete_locator_mappings,
            delete_part_infos,
            delete_process_infos,
            replace_locator_mappings,
            replace_part_infos,
            replace_process_infos,
            append_pipeline_data,
            delete_pipeline_data_by_date,
            get_plan_data_preview,
            append_plan_data,
            delete_plan_data_by_date,
            get_daily_rate_preview,
            upsert_daily_rate,
            delete_daily_rates,
            replace_daily_rates,
            parse_and_transpose_pipeline_csv,
            sync_pipeline_locators,
            get_plan_data_for_shift,
            get_all_part_numbers,
            get_part_numbers_by_process,
            get_reason_codes_by_process,
            submit_shift_production,
            get_processes_preview,
            upsert_process,
            delete_processes,
            replace_processes,
            get_reason_codes_preview,
            upsert_reason_codes,
            delete_reason_codes,
            replace_reason_codes,
            get_processes,
            get_active_weeks,
            get_machines_by_process,
            get_rolling_gaps,
            calculate_demand_distribution
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
