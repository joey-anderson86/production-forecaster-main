use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::path::Path;
use tiberius::{Client, Config, SqlBrowser};
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncWriteCompatExt;
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize)]
struct CsvRow {
    #[serde(rename = "Department")]
    department: String,
    #[serde(rename = "WeekIdentifier")]
    week_identifier: String,
    #[serde(rename = "PartNumber")]
    part_number: String,
    #[serde(rename = "DayOfWeek")]
    day_of_week: String,
    #[serde(rename = "Target")]
    target: String,
    #[serde(rename = "Actual")]
    actual: String,
    #[serde(rename = "ReasonCode")]
    reason_code: String,
    #[serde(rename = "Date")]
    date: String,
    #[serde(rename = "NumericDate")]
    numeric_date: String,
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
struct PlanRow {
    date: Option<String>,
    part_number: Option<String>,
    part_name: Option<String>,
    process: Option<String>,
    qty: Option<i16>,
}

// State for managing the MSSQL connection status and settings
pub struct DbState {
    pub connection_string: Mutex<Option<String>>,
}

#[tauri::command]
async fn update_csv_entry(
    file_path: String,
    department: String,
    week_label: String,
    part_number: String,
    day_of_week: String,
    new_target: Option<i32>,
    new_actual: Option<i32>,
    new_reason: String,
    new_date: String,
    new_numeric_date: i32,
) -> Result<(), String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    // Read the entire CSV
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(path)
        .map_err(|e| e.to_string())?;

    let mut rows: Vec<CsvRow> = Vec::new();
    let mut found = false;

    for result in rdr.deserialize() {
        let mut row: CsvRow = result.map_err(|e| e.to_string())?;
        
        // Check for match
        if row.department == department 
            && row.week_identifier == week_label 
            && row.part_number == part_number 
            && row.day_of_week == day_of_week 
        {
            row.target = new_target.map(|v| v.to_string()).unwrap_or_default();
            row.actual = new_actual.map(|v| v.to_string()).unwrap_or_default();
            row.reason_code = new_reason.clone();
            row.date = new_date.clone();
            row.numeric_date = new_numeric_date.to_string();
            found = true;
        }
        rows.push(row);
    }

    if !found {
        return Err("Matching row not found in CSV".into());
    }

    // Write back to the CSV
    let file = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|e| e.to_string())?;

    let mut wtr = csv::WriterBuilder::new()
        .has_headers(true)
        .from_writer(file);

    for row in rows {
        wtr.serialize(row).map_err(|e| e.to_string())?;
    }

    wtr.flush().map_err(|e| e.to_string())?;

    Ok(())
}

async fn create_client(connection_string: &str) -> Result<Client<tokio_util::compat::Compat<TcpStream>>, String> {
    let config = Config::from_ado_string(connection_string).map_err(|e| format!("Invalid connection string: {}", e))?;
    let tcp = TcpStream::connect_named(&config).await.map_err(|e| format!("Failed to connect to TCP socket: {}", e))?;
    tcp.set_nodelay(true).map_err(|e| format!("Failed to set TCP nodelay: {}", e))?;
    let client = Client::connect(config, tcp.compat_write()).await.map_err(|e| format!("Failed to authenticate with MSSQL server: {:?}", e))?;
    Ok(client)
}

fn get_i16_robust(row: &tiberius::Row, col: &str) -> Option<i16> {
    if let Ok(val) = row.try_get::<i16, _>(col) {
        return val;
    }
    if let Ok(val) = row.try_get::<&str, _>(col) {
        return val.and_then(|s| s.trim().parse::<i16>().ok());
    }
    None
}

#[tauri::command]
async fn test_mssql_connection(connection_string: String) -> Result<String, String> {
    let mut client = create_client(&connection_string).await?;
    let _row: Option<tiberius::Row> = client.query("SELECT 1", &[]).await.map_err(|e| format!("Failed to execute query: {:?}", e))?
        .into_row().await.map_err(|e| format!("Failed to read row: {:?}", e))?;
    Ok("Successfully connected to MSSQL!".to_string())
}

#[tauri::command]
async fn get_locator_mapping_preview(connection_string: String) -> Result<Vec<LocatorMapping>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client.query("SELECT TOP 100 WIPLocator, Process, DaysFromShipment FROM dbo.LocatorMapping", &[]).await.map_err(|e| e.to_string())?;
    let rows = stream.into_first_result().await.map_err(|e| e.to_string())?;
    
    let result = rows.into_iter().map(|row| {
        LocatorMapping {
            wip_locator: row.get::<&str, _>("WIPLocator").map(|s| s.trim().to_string()),
            process: row.get::<&str, _>("Process").map(|s| s.trim().to_string()),
            days_from_shipment: get_i16_robust(&row, "DaysFromShipment"),
        }
    }).collect();
    
    Ok(result)
}

#[tauri::command]
async fn get_part_info_preview(connection_string: String) -> Result<Vec<PartInfo>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client.query("SELECT TOP 100 PartNumber, Process, BatchSize, ProcessingTime FROM dbo.PartInfo", &[]).await.map_err(|e| e.to_string())?;
    let rows = stream.into_first_result().await.map_err(|e| e.to_string())?;
    
    let result = rows.into_iter().map(|row| {
        PartInfo {
            part_number: row.get::<&str, _>("PartNumber").map(|s| s.trim().to_string()),
            process: row.get::<&str, _>("Process").map(|s| s.trim().to_string()),
            batch_size: get_i16_robust(&row, "BatchSize"),
            processing_time: get_i16_robust(&row, "ProcessingTime"),
        }
    }).collect();
    
    Ok(result)
}

#[tauri::command]
async fn get_process_info_preview(connection_string: String) -> Result<Vec<ProcessInfo>, String> {
    let mut client = create_client(&connection_string).await?;
    // Formatted date to string for simple transfer
    let stream = client.query("SELECT TOP 100 Process, CONVERT(VARCHAR, Date, 23) as Date, HoursAvailable, MachineID FROM dbo.ProcessInfo", &[]).await.map_err(|e| e.to_string())?;
    let rows = stream.into_first_result().await.map_err(|e| e.to_string())?;
    
    let result = rows.into_iter().map(|row| {
        ProcessInfo {
            process: row.get::<&str, _>("Process").map(|s| s.trim().to_string()),
            date: row.get::<&str, _>("Date").map(|s| s.trim().to_string()),
            hours_available: get_i16_robust(&row, "HoursAvailable"),
            machine_id: row.get::<&str, _>("MachineID").map(|s| s.trim().to_string()),
        }
    }).collect();
    
    Ok(result)
}

#[tauri::command]
async fn get_pipeline_data_preview(connection_string: String) -> Result<Vec<PipelineRow>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client.query("SELECT TOP 500 CONVERT(VARCHAR, Date, 23) as Date, Customer, CustomerCity, PartNumber, PartName, WIPLocator, Qty FROM dbo.PipelineData", &[]).await.map_err(|e| e.to_string())?;
    let rows = stream.into_first_result().await.map_err(|e| e.to_string())?;
    
    let result = rows.into_iter().map(|row| {
        PipelineRow {
            date: row.get::<&str, _>("Date").map(|s| s.trim().to_string()),
            customer: row.get::<&str, _>("Customer").map(|s| s.trim().to_string()),
            customer_city: row.get::<&str, _>("CustomerCity").map(|s| s.trim().to_string()),
            part_number: row.get::<&str, _>("PartNumber").map(|s| s.trim().to_string()),
            part_name: row.get::<&str, _>("PartName").map(|s| s.trim().to_string()),
            wip_locator: row.get::<&str, _>("WIPLocator").map(|s| s.trim().to_string()),
            qty: get_i16_robust(&row, "Qty"),
        }
    }).collect();
    
    Ok(result)
}

#[tauri::command]
async fn get_plan_data_preview(connection_string: String) -> Result<Vec<PlanRow>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client.query("SELECT TOP 500 CONVERT(VARCHAR, Date, 23) as Date, PartNumber, PartName, Process, Qty FROM dbo.PlanData", &[]).await.map_err(|e| e.to_string())?;
    let rows = stream.into_first_result().await.map_err(|e| e.to_string())?;
    
    let result = rows.into_iter().map(|row| {
        PlanRow {
            date: row.get::<&str, _>("Date").map(|s| s.trim().to_string()),
            part_number: row.get::<&str, _>("PartNumber").map(|s| s.trim().to_string()),
            part_name: row.get::<&str, _>("PartName").map(|s| s.trim().to_string()),
            process: row.get::<&str, _>("Process").map(|s| s.trim().to_string()),
            qty: get_i16_robust(&row, "Qty"),
        }
    }).collect();
    
    Ok(result)
}

#[tauri::command]
async fn append_pipeline_data(connection_string: String, records: Vec<PipelineRow>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client.simple_query("BEGIN TRANSACTION").await.map_err(|e| e.to_string())?;
    
    for rec in records {
        client.execute(
            "INSERT INTO dbo.PipelineData (Date, Customer, CustomerCity, PartNumber, PartName, WIPLocator, Qty) 
             VALUES (CAST(@p1 as DATE), @p2, @p3, @p4, @p5, @p6, @p7)",
            &[&rec.date, &rec.customer, &rec.customer_city, &rec.part_number, &rec.part_name, &rec.wip_locator, &rec.qty],
        ).await.map_err(|e| e.to_string())?;
    }

    client.simple_query("COMMIT TRANSACTION").await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_pipeline_data_by_date(connection_string: String, date: String) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client.execute("DELETE FROM dbo.PipelineData WHERE Date = CAST(@p1 as DATE)", &[&date])
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn append_plan_data(connection_string: String, records: Vec<PlanRow>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client.simple_query("BEGIN TRANSACTION").await.map_err(|e| e.to_string())?;
    
    for rec in records {
        client.execute(
            "INSERT INTO dbo.Plan (Date, PartNumber, PartName, Process, Qty) 
             VALUES (CAST(@p1 as DATE), @p2, @p3, @p4, @p5)",
            &[&rec.date, &rec.part_number, &rec.part_name, &rec.process, &rec.qty],
        ).await.map_err(|e| e.to_string())?;
    }

    client.simple_query("COMMIT TRANSACTION").await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_plan_data_by_date(connection_string: String, date: String) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client.execute("DELETE FROM dbo.Plan WHERE Date = CAST(@p1 as DATE)", &[&date])
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn upsert_locator_mapping(connection_string: String, records: Vec<LocatorMapping>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        client.execute(
            "MERGE dbo.LocatorMapping AS target
             USING (SELECT @p1 as WIPLocator, @p2 as Process, @p3 as DaysFromShipment) AS source
             ON (target.WIPLocator = source.WIPLocator)
             WHEN MATCHED THEN
                UPDATE SET Process = source.Process, DaysFromShipment = source.DaysFromShipment
             WHEN NOT MATCHED THEN
                INSERT (WIPLocator, Process, DaysFromShipment)
                VALUES (source.WIPLocator, source.Process, source.DaysFromShipment);",
            &[&rec.wip_locator, &rec.process, &rec.days_from_shipment],
        ).await.map_err(|e| e.to_string())?;
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
async fn upsert_process_info(connection_string: String, records: Vec<ProcessInfo>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        client.execute(
            "MERGE dbo.ProcessInfo AS target
             USING (SELECT @p1 as Process, CAST(@p2 as DATE) as Date, @p3 as HoursAvailable, @p4 as MachineID) AS source
             ON (target.Process = source.Process AND target.Date = source.Date AND target.MachineID = source.MachineID)
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
async fn delete_locator_mappings(connection_string: String, wip_locators: Vec<String>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for id in wip_locators {
        client.execute("DELETE FROM dbo.LocatorMapping WHERE WIPLocator = @p1", &[&id]).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct PartInfoId {
    part_number: String,
    process: String,
}

#[tauri::command]
async fn delete_part_infos(connection_string: String, identifiers: Vec<PartInfoId>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for id in identifiers {
        client.execute("DELETE FROM dbo.PartInfo WHERE PartNumber = @p1 AND Process = @p2", &[&id.part_number, &id.process]).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct ProcessInfoId {
    process: String,
    date: String,
    machine_id: String,
}

#[tauri::command]
async fn delete_process_infos(connection_string: String, identifiers: Vec<ProcessInfoId>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for id in identifiers {
        client.execute("DELETE FROM dbo.ProcessInfo WHERE Process = @p1 AND Date = @p2 AND MachineID = @p3", &[&id.process, &id.date, &id.machine_id]).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn replace_locator_mappings(connection_string: String, records: Vec<LocatorMapping>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client.simple_query("BEGIN TRANSACTION").await.map_err(|e| e.to_string())?;
    
    // Clear and re-populate
    client.execute("DELETE FROM dbo.LocatorMapping", &[]).await.map_err(|e| e.to_string())?;
    for rec in records {
        client.execute(
            "INSERT INTO dbo.LocatorMapping (WIPLocator, Process, DaysFromShipment) VALUES (@p1, @p2, @p3)",
            &[&rec.wip_locator, &rec.process, &rec.days_from_shipment],
        ).await.map_err(|e| e.to_string())?;
    }

    client.simple_query("COMMIT TRANSACTION").await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn replace_part_infos(connection_string: String, records: Vec<PartInfo>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client.simple_query("BEGIN TRANSACTION").await.map_err(|e| e.to_string())?;
    
    client.execute("DELETE FROM dbo.PartInfo", &[]).await.map_err(|e| e.to_string())?;
    for rec in records {
        client.execute(
            "INSERT INTO dbo.PartInfo (PartNumber, Process, BatchSize, ProcessingTime) VALUES (@p1, @p2, @p3, @p4)",
            &[&rec.part_number, &rec.process, &rec.batch_size, &rec.processing_time],
        ).await.map_err(|e| e.to_string())?;
    }

    client.simple_query("COMMIT TRANSACTION").await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn replace_process_infos(connection_string: String, records: Vec<ProcessInfo>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client.simple_query("BEGIN TRANSACTION").await.map_err(|e| e.to_string())?;
    
    client.execute("DELETE FROM dbo.ProcessInfo", &[]).await.map_err(|e| e.to_string())?;
    for rec in records {
        client.execute(
            "INSERT INTO dbo.ProcessInfo (Process, Date, HoursAvailable, MachineID) VALUES (@p1, CAST(@p2 as DATE), @p3, @p4)",
            &[&rec.process, &rec.date, &rec.hours_available, &rec.machine_id],
        ).await.map_err(|e| e.to_string())?;
    }

    client.simple_query("COMMIT TRANSACTION").await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .manage(DbState { connection_string: Mutex::new(None) })
    .invoke_handler(tauri::generate_handler![
        update_csv_entry, 
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
        delete_plan_data_by_date
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




