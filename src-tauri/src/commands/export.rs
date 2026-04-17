#[tauri::command]
pub async fn save_csv_file(
    app_handle: tauri::AppHandle,
    content: String,
    default_path: String,
) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app_handle
        .dialog()
        .file()
        .set_file_name(&default_path)
        .add_filter("CSV", &["csv"])
        .blocking_save_file();

    if let Some(path) = file_path {
        let path_buf = path.into_path().map_err(|e| e.to_string())?;
        std::fs::write(path_buf, content).map_err(|e| e.to_string())?;
    } else {
        return Err("Save cancelled".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn save_csv_file_with_handle(
    app_handle: tauri::AppHandle,
    content: String,
    default_path: String,
) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app_handle
        .dialog()
        .file()
        .set_file_name(&default_path)
        .add_filter("CSV", &["csv"])
        .blocking_save_file();

    if let Some(path) = file_path {
        let path_buf = path.into_path().map_err(|e| e.to_string())?;
        std::fs::write(path_buf, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}
