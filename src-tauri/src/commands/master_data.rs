use crate::models::*;
use crate::db::*;

#[tauri::command]
pub async fn get_locator_mapping_preview(
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
            process_name: row
                .get::<&str, _>("ProcessName")
                .map(|s| s.trim().to_string()),
            days_from_shipment: get_i32_robust(&row, "DaysFromShipment"),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_part_info_preview(
    connection_string: String,
    process_filter: Option<String>,
    part_filter: Vec<String>,
) -> Result<Vec<PartInfo>, String> {
    let mut client = create_client(&connection_string).await?;

    let mut query_str = String::from("SELECT TOP 2000 PartNumber, ProcessName, BatchSize, ProcessingTime FROM dbo.PartInfo WHERE 1=1");
    let mut params: Vec<Box<dyn tiberius::ToSql + Send + Sync>> = Vec::new();

    if let Some(ref process) = process_filter {
        if !process.is_empty() {
            query_str.push_str(&format!(" AND ProcessName = @p{}", params.len() + 1));
            params.push(Box::new(process.clone()));
        }
    }

    if !part_filter.is_empty() {
        query_str.push_str(" AND PartNumber IN (");
        for (i, part) in part_filter.iter().enumerate() {
            if i > 0 {
                query_str.push_str(", ");
            }
            query_str.push_str(&format!("@p{}", params.len() + 1));
            params.push(Box::new(part.clone()));
        }
        query_str.push_str(")");
    }

    query_str.push_str(" ORDER BY ProcessName ASC, PartNumber ASC");

    let param_refs: Vec<&dyn tiberius::ToSql> = params.iter().map(|p| p.as_ref() as &dyn tiberius::ToSql).collect();

    let stream = client
        .query(query_str, &param_refs)
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
            process_name: row
                .get::<&str, _>("ProcessName")
                .map(|s| s.trim().to_string()),
            batch_size: get_i32_robust(&row, "BatchSize"),
            processing_time: get_i32_robust(&row, "ProcessingTime"),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_process_info_preview(
    connection_string: String,
    week_filter: Option<String>,
    process_filter: Option<String>,
) -> Result<Vec<ProcessInfo>, String> {
    let mut client = create_client(&connection_string).await?;

    let mut query_str = String::from("SELECT TOP 2000 ProcessName, CONVERT(VARCHAR, Date, 23) as Date, HoursAvailable, MachineID, Shift, WeekIdentifier FROM dbo.ProcessInfo WHERE 1=1");
    let mut params: Vec<Box<dyn tiberius::ToSql + Send + Sync>> = Vec::new();

    if let Some(ref week) = week_filter {
        if !week.is_empty() {
            query_str.push_str(&format!(" AND WeekIdentifier = @p{}", params.len() + 1));
            params.push(Box::new(week.clone()));
        }
    }

    if let Some(ref process) = process_filter {
        if !process.is_empty() {
            query_str.push_str(&format!(" AND ProcessName = @p{}", params.len() + 1));
            params.push(Box::new(process.clone()));
        }
    }

    query_str.push_str(" ORDER BY Date DESC, ProcessName ASC");

    // Convert Vec<Box<dyn ToSql...>> to &[&dyn ToSql]
    let param_refs: Vec<&dyn tiberius::ToSql> = params.iter().map(|p| p.as_ref() as &dyn tiberius::ToSql).collect();

    let stream = client
        .query(query_str, &param_refs)
        .await
        .map_err(|e| e.to_string())?;

    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| ProcessInfo {
            process_name: row
                .get::<&str, _>("ProcessName")
                .map(|s| s.trim().to_string()),
            date: row.get::<&str, _>("Date").map(|s| s.trim().to_string()),
            hours_available: get_f64_robust(&row, "HoursAvailable"),
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
pub async fn get_process_info(
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
            process_name: row
                .get::<&str, _>("ProcessName")
                .map(|s| s.trim().to_string()),
            date: row.get::<&str, _>("Date").map(|s| s.trim().to_string()),
            hours_available: get_f64_robust(&row, "HoursAvailable"),
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
pub async fn get_all_part_numbers(connection_string: String) -> Result<Vec<String>, String> {
    let mut client = create_client(&connection_string).await?;
    let stream = client.query(
        "SELECT DISTINCT PartNumber FROM dbo.ItemMaster WHERE PartNumber IS NOT NULL ORDER BY PartNumber",
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
pub async fn get_part_numbers_by_process(
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
pub async fn get_reason_codes_by_process(
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
pub async fn upsert_locator_mapping(
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
                &[&rec.wip_locator, &rec.process_name, &rec.days_from_shipment],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn upsert_part_info(connection_string: String, records: Vec<PartInfo>) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        let pn = rec.part_number.as_deref().unwrap_or("").trim();
        let pr = rec.process_name.as_deref().unwrap_or("").trim();
        if pn.is_empty() || pr.is_empty() {
            continue;
        }

        // 1. Ensure part exists in ItemMaster
        client.execute(
            "IF NOT EXISTS (SELECT 1 FROM dbo.ItemMaster WHERE PartNumber = @p1)
             INSERT INTO dbo.ItemMaster (PartNumber) VALUES (@p1)",
            &[&pn],
        ).await.map_err(|e| e.to_string())?;

        // 2. Upsert into PartRoutings
        // We match by PartNumber and ProcessName to mimic legacy 1:1 behavior while supporting the new schema
        client.execute(
            "MERGE dbo.PartRoutings AS target
             USING (SELECT @p1 as PartNumber, @p2 as ProcessName, @p3 as BatchSize, @p4 as ProcessingTime) AS source
             ON (target.PartNumber = source.PartNumber AND target.ProcessName = source.ProcessName)
             WHEN MATCHED THEN
                UPDATE SET BatchSize = source.BatchSize, ProcessingTimeMins = CAST(source.ProcessingTime AS FLOAT)
             WHEN NOT MATCHED THEN
                INSERT (PartNumber, ProcessName, BatchSize, ProcessingTimeMins, SequenceNumber, TransitShifts)
                VALUES (source.PartNumber, source.ProcessName, source.BatchSize, CAST(source.ProcessingTime AS FLOAT), 10, 0);",
            &[&pn, &pr, &rec.batch_size, &rec.processing_time],
        ).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn upsert_process_info(
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
            &[&rec.process_name, &rec.date, &rec.hours_available, &mid, &rec.shift, &week],
        ).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_locator_mappings(
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

#[tauri::command]
pub async fn delete_part_infos(
    connection_string: String,
    identifiers: Vec<PartInfoId>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for id in identifiers {
        client
            .execute(
                "DELETE FROM dbo.PartRoutings WHERE PartNumber = @p1 AND ProcessName = @p2",
                &[&id.part_number, &id.process_name],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_process_infos(
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
                &[&id.process_name, &id.date, &id.machine_id, &id.shift],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn replace_locator_mappings(
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
            &[&rec.wip_locator, &rec.process_name, &rec.days_from_shipment],
        ).await.map_err(|e| e.to_string())?;
    }

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn replace_part_infos(
    connection_string: String,
    records: Vec<PartInfo>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    // We only clear routings, as ItemMaster is a shared registry
    client
        .execute("DELETE FROM dbo.PartRoutings", &[])
        .await
        .map_err(|e| e.to_string())?;

    for rec in records {
        // Ensure part exists in ItemMaster
        client.execute(
            "IF NOT EXISTS (SELECT 1 FROM dbo.ItemMaster WHERE PartNumber = @p1)
             INSERT INTO dbo.ItemMaster (PartNumber) VALUES (@p1)",
            &[&rec.part_number],
        ).await.map_err(|e| e.to_string())?;

        client.execute(
            "INSERT INTO dbo.PartRoutings (PartNumber, ProcessName, BatchSize, ProcessingTimeMins, SequenceNumber, TransitShifts) 
             VALUES (@p1, @p2, @p3, CAST(@p4 AS FLOAT), 10, 0)",
            &[&rec.part_number, &rec.process_name, &rec.batch_size, &rec.processing_time],
        ).await.map_err(|e| e.to_string())?;
    }

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn replace_process_infos(
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
            &[&rec.process_name, &rec.date, &rec.hours_available, &mid, &rec.shift, &rec.week_identifier],
        ).await.map_err(|e| e.to_string())?;
    }

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_processes_preview(
    connection_string: String,
    process_filter: Option<String>,
) -> Result<Vec<Process>, String> {
    let mut client = create_client(&connection_string).await?;
    let effective_filter = process_filter.as_deref().filter(|s| !s.is_empty());

    let query = if effective_filter.is_some() {
        "SELECT ProcessName, MachineID FROM dbo.Process WHERE ProcessName = @p1"
    } else {
        "SELECT ProcessName, MachineID FROM dbo.Process"
    };

    let params: Vec<&dyn tiberius::ToSql> = match &effective_filter {
        Some(p) => vec![p as &dyn tiberius::ToSql],
        None => vec![],
    };

    let stream = client.query(query, &params).await.map_err(|e| e.to_string())?;
    let rows = stream.into_first_result().await.map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| Process {
            process_name: row
                .get::<&str, _>("ProcessName")
                .unwrap_or_default()
                .trim()
                .to_string(),
            machine_id: row
                .get::<&str, _>("MachineID")
                .map(|s| s.trim().to_string()),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn upsert_process(connection_string: String, records: Vec<Process>) -> Result<(), String> {
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
pub async fn delete_processes(connection_string: String, records: Vec<Process>) -> Result<(), String> {
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
pub async fn replace_processes(connection_string: String, records: Vec<Process>) -> Result<(), String> {
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
pub async fn get_reason_codes_preview(
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
            process_name: row
                .get::<&str, _>("ProcessName")
                .map(|s| s.trim().to_string()),
            reason_code: row
                .get::<&str, _>("ReasonCode")
                .map(|s| s.trim().to_string()),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn upsert_reason_codes(
    connection_string: String,
    records: Vec<ReasonCodeData>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        client
            .execute(
                "MERGE dbo.ReasonCode AS target
             USING (SELECT @p1 as ProcessName, @p2 as ReasonCode) AS source
             ON (target.ProcessName = source.ProcessName AND target.ReasonCode = source.ReasonCode)
             WHEN NOT MATCHED THEN
                INSERT (ProcessName, ReasonCode) VALUES (source.ProcessName, source.ReasonCode);",
                &[&rec.process_name, &rec.reason_code],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_reason_codes(
    connection_string: String,
    records: Vec<ReasonCodeData>,
) -> Result<(), String> {
    let mut client = create_client(&connection_string).await?;
    for rec in records {
        client
            .execute(
                "DELETE FROM dbo.ReasonCode WHERE ProcessName = @p1 AND ReasonCode = @p2",
                &[&rec.process_name, &rec.reason_code],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn replace_reason_codes(
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
                &[&rec.process_name, &rec.reason_code],
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
pub async fn get_machines_by_process(
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
        .filter_map(|row| {
            row.get::<&str, _>("MachineID")
                .map(|s| s.trim().to_string())
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_processes(connection_string: String) -> Result<Vec<String>, String> {
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
        .filter_map(|row| {
            row.get::<&str, _>("ProcessName")
                .map(|s| s.trim().to_string())
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_active_weeks(connection_string: String) -> Result<Vec<String>, String> {
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

#[tauri::command]
pub async fn get_part_machine_capabilities(
    connection_string: &str,
) -> Result<Vec<PartMachineCapability>, String> {
    let mut client = create_client(connection_string).await?;
    let stream = client
        .query(
            "SELECT PartNumber, MachineID FROM dbo.PartMachineCapability ORDER BY PartNumber",
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
        .map(|row| PartMachineCapability {
            part_id: row
                .get::<&str, _>("PartNumber")
                .unwrap_or_default()
                .trim()
                .to_string(),
            machine_id: row
                .get::<&str, _>("MachineID")
                .unwrap_or_default()
                .trim()
                .to_string(),
            parts_per_hour: 0.0,
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn add_part_machine_capability(
    connection_string: &str,
    part_number: &str,
    machine_id: &str,
) -> Result<(), String> {
    let mut client = create_client(connection_string).await?;
    client
        .execute(
            "INSERT INTO dbo.PartMachineCapability (PartNumber, MachineID) VALUES (@p1, @p2)",
            &[&part_number, &machine_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_part_machine_capability(
    connection_string: &str,
    part_number: &str,
    machine_id: &str,
) -> Result<(), String> {
    let mut client = create_client(connection_string).await?;
    client
        .execute(
            "DELETE FROM dbo.PartMachineCapability WHERE PartNumber = @p1 AND MachineID = @p2",
            &[&part_number, &machine_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
