use crate::models::*;
use crate::db::*;
use std::path::Path;

#[tauri::command]
pub async fn get_pipeline_data_preview(connection_string: String) -> Result<Vec<PipelineRow>, String> {
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
            qty: get_i32_robust(&row, "Qty"),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn append_pipeline_data(
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
pub async fn delete_pipeline_data_by_date(
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
pub async fn parse_and_transpose_pipeline_csv(file_path: String) -> Result<Vec<PipelineRow>, String> {
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
            let qty = qty_str.trim().parse::<f64>().unwrap_or(0.0) as i32;

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
                        let qty = qty_str.trim().parse::<f64>().unwrap_or(0.0) as i32;
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
pub async fn sync_pipeline_locators(connection_string: String) -> Result<u64, String> {
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
