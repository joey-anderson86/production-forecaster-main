use crate::models::*;
use crate::db::*;

#[tauri::command]
pub async fn get_daily_rate_preview(connection_string: String) -> Result<Vec<DailyRateRow>, String> {
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
            week: get_i32_robust(&row, "Week").unwrap_or(0),
            year: get_i32_robust(&row, "Year").unwrap_or(0),
            qty: get_i32_robust(&row, "Qty").unwrap_or(0),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn upsert_daily_rate(
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
pub async fn delete_daily_rates(
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
pub async fn replace_daily_rates(
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
