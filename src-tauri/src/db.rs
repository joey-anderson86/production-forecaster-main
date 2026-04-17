use tiberius::{Client, Config, SqlBrowser};
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncWriteCompatExt;

pub async fn create_client(
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

pub fn get_i32_robust(row: &tiberius::Row, col: &str) -> Option<i32> {
    if let Ok(val) = row.try_get::<i32, _>(col) {
        return val;
    }
    if let Ok(val) = row.try_get::<i16, _>(col) {
        return val.map(|v| v as i32);
    }
    if let Ok(val) = row.try_get::<f64, _>(col) {
        return val.map(|v| v as i32);
    }
    if let Ok(val) = row.try_get::<&str, _>(col) {
        return val.and_then(|s| s.trim().parse::<i32>().ok());
    }
    None
}

#[tauri::command]
pub async fn test_mssql_connection(connection_string: String) -> Result<String, String> {
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
