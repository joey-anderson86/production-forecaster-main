use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DailyRateRow {
    pub part_number: Option<String>,
    pub week: i16,
    pub year: i16,
    pub qty: i16,
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
async fn upsert_scorecard_data(
    connection_string: String,
    records: Vec<ScorecardRow>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        client.execute(
            "MERGE dbo.DeliveryData AS target
             USING (SELECT @p1 as Department, @p2 as WeekIdentifier, @p3 as PartNumber, @p4 as DayOfWeek, 
                           @p5 as Target, @p6 as Actual, CAST(@p7 as DATE) as Date, @p8 as Shift, @p9 as ReasonCode) AS source
             ON (target.Department = source.Department AND target.PartNumber = source.PartNumber AND target.Date = source.Date AND (target.Shift = source.Shift OR (target.Shift IS NULL AND source.Shift IS NULL)))
             WHEN MATCHED THEN
                UPDATE SET Target = source.Target, Actual = source.Actual, WeekIdentifier = source.WeekIdentifier, DayOfWeek = source.DayOfWeek, ReasonCode = source.ReasonCode
             WHEN NOT MATCHED THEN
                INSERT (Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, Date, Shift, ReasonCode)
                VALUES (source.Department, source.WeekIdentifier, source.PartNumber, source.DayOfWeek, source.Target, source.Actual, source.Date, source.Shift, source.ReasonCode);",
            &[&rec.department, &rec.week_identifier, &rec.part_number, &rec.day_of_week, &rec.target, &rec.actual, &rec.date, &rec.shift, &rec.reason_code],
        ).await.map_err(|e| e.to_string())?;
    }
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
            "SELECT TOP 100 WIPLocator, Process, DaysFromShipment FROM dbo.LocatorMapping",
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
            process: row.get::<&str, _>("Process").map(|s| s.trim().to_string()),
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
            "SELECT TOP 100 PartNumber, Process, BatchSize, ProcessingTime FROM dbo.PartInfo",
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
            process: row.get::<&str, _>("Process").map(|s| s.trim().to_string()),
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
    let stream = client.query("SELECT TOP 100 Process, CONVERT(VARCHAR, Date, 23) as Date, HoursAvailable, MachineID FROM dbo.ProcessInfo", &[]).await.map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| ProcessInfo {
            process: row.get::<&str, _>("Process").map(|s| s.trim().to_string()),
            date: row.get::<&str, _>("Date").map(|s| s.trim().to_string()),
            hours_available: get_i16_robust(&row, "HoursAvailable"),
            machine_id: row
                .get::<&str, _>("MachineID")
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
    let stream = client.query("SELECT TOP 500 CONVERT(VARCHAR, Date, 23) as Date, PartNumber, '' as PartName, Department as Process, Target as Qty, Actual, ReasonCode, Shift, WeekIdentifier, DayOfWeek FROM dbo.DeliveryData", &[]).await.map_err(|e| e.to_string())?;
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
            process: row.get::<&str, _>("Process").map(|s| s.trim().to_string()),
            qty: get_i16_robust(&row, "Qty"),
            actual: get_i16_robust(&row, "Actual"),
            shift: row.get::<&str, _>("Shift").map(|s| s.trim().to_string()),
            week_identifier: row.get::<&str, _>("WeekIdentifier").map(|s| s.trim().to_string()),
            day_of_week: row.get::<&str, _>("DayOfWeek").map(|s| s.trim().to_string()),
            reason_code: row.get::<&str, _>("ReasonCode").map(|s| s.trim().to_string()),
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
            "SELECT PartNumber, '' as PartName, Department as Process, Target as Qty, Actual, ReasonCode, CONVERT(VARCHAR, Date, 23) as Date, Shift, WeekIdentifier, DayOfWeek 
         FROM dbo.DeliveryData 
         WHERE Date = CAST(@p1 AS DATE) 
           AND LTRIM(RTRIM(Department)) = LTRIM(RTRIM(@p2)) 
           AND (LTRIM(RTRIM(Shift)) = LTRIM(RTRIM(@p3)) OR Shift IS NULL)",
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
            process: row.get::<&str, _>("Process").map(|s| s.trim().to_string()),
            qty: get_i16_robust(&row, "Qty"),
            actual: get_i16_robust(&row, "Actual"),
            shift: row.get::<&str, _>("Shift").map(|s| s.trim().to_string()),
            week_identifier: row.get::<&str, _>("WeekIdentifier").map(|s| s.trim().to_string()),
            day_of_week: row.get::<&str, _>("DayOfWeek").map(|s| s.trim().to_string()),
            reason_code: row.get::<&str, _>("ReasonCode").map(|s| s.trim().to_string()),
        })
        .collect();
 
    Ok(result)
}

#[tauri::command]
async fn get_all_part_numbers(connection_string: String) -> Result<Vec<String>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client.query(
        "SELECT DISTINCT LTRIM(RTRIM(PartNumber)) as PartNumber FROM dbo.PartInfo WHERE PartNumber IS NOT NULL ORDER BY PartNumber",
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
        "SELECT DISTINCT LTRIM(RTRIM(PartNumber)) as PartNumber FROM dbo.PartInfo WHERE LTRIM(RTRIM(Process)) = LTRIM(RTRIM(@p1)) AND PartNumber IS NOT NULL ORDER BY PartNumber",
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
             USING (SELECT @p1 as WIPLocator, @p2 as Process, @p3 as DaysFromShipment) AS source
             ON (target.WIPLocator = source.WIPLocator)
             WHEN MATCHED THEN
                UPDATE SET Process = source.Process, DaysFromShipment = source.DaysFromShipment
             WHEN NOT MATCHED THEN
                INSERT (WIPLocator, Process, DaysFromShipment)
                VALUES (source.WIPLocator, source.Process, source.DaysFromShipment);",
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
             USING (SELECT @p1 as PartNumber, @p2 as Process, @p3 as BatchSize, @p4 as ProcessingTime) AS source
             ON (target.PartNumber = source.PartNumber AND target.Process = source.Process)
             WHEN MATCHED THEN
                UPDATE SET BatchSize = source.BatchSize, ProcessingTime = source.ProcessingTime
             WHEN NOT MATCHED THEN
                INSERT (PartNumber, Process, BatchSize, ProcessingTime)
                VALUES (source.PartNumber, source.Process, source.BatchSize, source.ProcessingTime);",
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
        client.execute(
            "MERGE dbo.ProcessInfo AS target
             USING (SELECT @p1 as Process, CAST(@p2 as DATE) as Date, @p3 as HoursAvailable, @p4 as MachineID) AS source
             ON (ISNULL(target.Process, '') = ISNULL(source.Process, '') AND target.Date = source.Date AND ISNULL(target.MachineID, '') = ISNULL(source.MachineID, ''))
             WHEN MATCHED THEN
                UPDATE SET HoursAvailable = source.HoursAvailable
             WHEN NOT MATCHED THEN
                INSERT (Process, Date, HoursAvailable, MachineID)
                VALUES (source.Process, source.Date, source.HoursAvailable, source.MachineID);",
            &[&rec.process, &rec.date, &rec.hours_available, &rec.machine_id],
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
                "DELETE FROM dbo.PartInfo WHERE PartNumber = @p1 AND Process = @p2",
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
             WHERE ISNULL(Process, '') = ISNULL(@p1, '') 
               AND Date = CAST(@p2 as DATE) 
               AND ISNULL(MachineID, '') = ISNULL(@p3, '')",
                &[&id.process, &id.date, &id.machine_id],
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
            "INSERT INTO dbo.LocatorMapping (WIPLocator, Process, DaysFromShipment) VALUES (@p1, @p2, @p3)",
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
            "INSERT INTO dbo.PartInfo (PartNumber, Process, BatchSize, ProcessingTime) VALUES (@p1, @p2, @p3, @p4)",
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
        client.execute(
            "INSERT INTO dbo.ProcessInfo (Process, Date, HoursAvailable, MachineID) VALUES (@p1, CAST(@p2 as DATE), @p3, @p4)",
            &[&rec.process, &rec.date, &rec.hours_available, &rec.machine_id],
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
        .query("SELECT Process FROM dbo.Process", &[])
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
                .get::<&str, _>("Process")
                .unwrap_or_default()
                .trim()
                .to_string(),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
async fn upsert_process(connection_string: String, records: Vec<Process>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        client
            .execute(
                "MERGE dbo.Process AS target
             USING (SELECT @p1 as Process) AS source
             ON (LTRIM(RTRIM(target.Process)) = LTRIM(RTRIM(source.Process)))
             WHEN NOT MATCHED THEN
                INSERT (Process) VALUES (source.Process);",
                &[&rec.process_name],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn delete_processes(
    connection_string: String,
    process_names: Vec<String>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for name in process_names {
        client
            .execute(
                "DELETE FROM dbo.Process WHERE LTRIM(RTRIM(Process)) = LTRIM(RTRIM(@p1))",
                &[&name],
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
        client
            .execute(
                "INSERT INTO dbo.Process (Process) VALUES (@p1)",
                &[&rec.process_name],
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
            delete_scorecard_week,
            delete_scorecard_row,
            test_mssql_connection,
            get_locator_mapping_preview,
            get_part_info_preview,
            get_process_info_preview,
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
            submit_shift_production,
            get_processes_preview,
            upsert_process,
            delete_processes,
            replace_processes
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
