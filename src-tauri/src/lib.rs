use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::path::Path;

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

#[tauri::command]
async fn test_mssql_connection(connection_string: String) -> Result<String, String> {
    use tiberius::{Client, Config, SqlBrowser};
    use tokio::net::TcpStream;
    use tokio_util::compat::TokioAsyncWriteCompatExt;

    let config = Config::from_ado_string(&connection_string).map_err(|e| format!("Invalid connection string: {}", e))?;
    
    let tcp = TcpStream::connect_named(&config).await.map_err(|e| format!("Failed to connect to TCP socket: {}", e))?;
    tcp.set_nodelay(true).map_err(|e| format!("Failed to set TCP nodelay: {}", e))?;
    
    let mut client = Client::connect(config, tcp.compat_write()).await.map_err(|e| format!("Failed to authenticate with MSSQL server: {:?}", e))?;
    
    // Test the connection by doing a simple select
    let _row: Option<tiberius::Row> = client.query("SELECT 1", &[]).await.map_err(|e| format!("Failed to execute query: {:?}", e))?
        .into_row().await.map_err(|e| format!("Failed to read row: {:?}", e))?;
    
    Ok("Successfully connected to MSSQL!".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![update_csv_entry, test_mssql_connection])
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
