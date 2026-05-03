use crate::models::*;
use crate::db::*;
use tiberius::ToSql;

#[tauri::command]
pub async fn get_scorecard_data(connection_string: String) -> Result<Vec<ScorecardRow>, String> {
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
                .to_uppercase(),
            day_of_week: row
                .get::<&str, _>("DayOfWeek")
                .unwrap_or_default()
                .trim()
                .to_string(),
            target: get_i32_robust(&row, "Target"),
            actual: get_i32_robust(&row, "Actual"),
            date: row.get::<&str, _>("Date").map(|s| s.trim().to_string()),
            shift: row.get::<&str, _>("Shift").map(|s| s.trim().to_uppercase()),
            reason_code: row
                .get::<&str, _>("ReasonCode")
                .map(|s| s.trim().to_string()),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_rolling_gaps(
    connection_string: String,
    department: String,
    as_of_date: Option<String>,
) -> Result<Vec<RollingGapRow>, String> {
    let mut client = create_client(&connection_string).await?;
    
    // If as_of_date is provided, use it; otherwise default to end of today
    let query = if let Some(_) = &as_of_date {
        "
        WITH RankedGaps AS (
            SELECT 
                PartNumber,
                Shift,
                SUM(CAST(ISNULL(Actual, 0) AS INT) - CAST(ISNULL(Target, 0) AS INT)) OVER (PARTITION BY PartNumber, Shift ORDER BY Date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as RollingGap,
                ROW_NUMBER() OVER (PARTITION BY PartNumber, Shift ORDER BY Date DESC) as rn
            FROM dbo.DeliveryData
            WHERE Department = @p1 AND Date <= CAST(@p2 AS DATE)
        )
        SELECT PartNumber, Shift, RollingGap
        FROM RankedGaps
        WHERE rn = 1
        "
    } else {
        "
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
        "
    };

    let stream = if let Some(date) = as_of_date {
        client.query(query, &[&department, &date]).await
    } else {
        client.query(query, &[&department]).await
    }.map_err(|e| e.to_string())?;
    let rows = stream
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let result = rows
        .into_iter()
        .map(|row| RollingGapRow {
            part_number: row
                .get::<&str, _>("PartNumber")
                .unwrap_or_default()
                .trim()
                .to_string(),
            shift: row
                .get::<&str, _>("Shift")
                .unwrap_or_default()
                .trim()
                .to_string(),
            rolling_gap: row.get::<i32, _>("RollingGap").unwrap_or_default(),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn upsert_scorecard_data(
    connection_string: String,
    mut records: Vec<ScorecardRow>,
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
            Target INT,
            Actual INT,
            Date DATE,
            Shift NVARCHAR(50),
            ReasonCode NVARCHAR(50)
        )
    ";

    client
        .simple_query(create_temp_sql)
        .await
        .map_err(|e| e.to_string())?;

    // Normalize data before processing to avoid lifetime issues with dynamic strings in `params`
    for rec in &mut records {
        rec.part_number = rec.part_number.trim().to_uppercase();
        let normalized_shift = rec.shift.as_deref().unwrap_or("A").trim().to_uppercase();
        rec.shift = Some(if normalized_shift.is_empty() {
            "A".to_string()
        } else {
            normalized_shift
        });
        rec.reason_code = rec.reason_code.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    }

    ensure_reason_codes_exist(&mut client, &records).await?;

    // Insert into temp table in batches to respect 2000 param limit
    let chunk_size = 200; // 9 params * 200 = 1800 params < 2000
    for chunk in records.chunks(chunk_size) {
        let mut sql = String::from("INSERT INTO #TempDeliveryData (Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, Date, Shift, ReasonCode) VALUES ");
        let mut params: Vec<&dyn ToSql> = Vec::new();
        let mut param_idx = 1;

        for (i, rec) in chunk.iter().enumerate() {
            if i > 0 {
                sql.push_str(", ");
            }
            sql.push_str(&format!(
                "(@p{}, @p{}, @p{}, @p{}, @p{}, @p{}, CAST(@p{} AS DATE), @p{}, @p{})",
                param_idx,
                param_idx + 1,
                param_idx + 2,
                param_idx + 3,
                param_idx + 4,
                param_idx + 5,
                param_idx + 6,
                param_idx + 7,
                param_idx + 8
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

        client
            .execute(&sql, &params)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Perform bulk MERGE
    let merge_sql = "
        MERGE dbo.DeliveryData AS target
        USING #TempDeliveryData AS source
        ON (target.Department = source.Department 
            AND target.PartNumber = source.PartNumber 
            AND CAST(target.Date AS DATE) = source.Date 
            AND (target.Shift = source.Shift OR (target.Shift IS NULL AND source.Shift = 'A')))
        WHEN MATCHED THEN
            UPDATE SET 
                Target = source.Target, 
                Actual = source.Actual, 
                WeekIdentifier = source.WeekIdentifier, 
                DayOfWeek = source.DayOfWeek, 
                ReasonCode = source.ReasonCode,
                Shift = source.Shift
        WHEN NOT MATCHED THEN
            INSERT (Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, Date, Shift, ReasonCode)
            VALUES (source.Department, source.WeekIdentifier, source.PartNumber, source.DayOfWeek, source.Target, source.Actual, source.Date, source.Shift, source.ReasonCode);
    ";

    client
        .execute(merge_sql, &[])
        .await
        .map_err(|e| e.to_string())?;

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn replace_delivery_data(
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

    // Normalize and ensure ReasonCodes exist
    let mut records = records;
    for rec in &mut records {
        rec.part_number = rec.part_number.trim().to_uppercase();
        let normalized_shift = rec.shift.as_deref().unwrap_or("A").trim().to_uppercase();
        rec.shift = Some(if normalized_shift.is_empty() {
            "A".to_string()
        } else {
            normalized_shift
        });
        rec.reason_code = rec.reason_code.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    }

    ensure_reason_codes_exist(&mut client, &records).await?;

    let create_temp_sql = "
        CREATE TABLE #TempDeliveryData (
            Department NVARCHAR(50),
            WeekIdentifier NVARCHAR(50),
            PartNumber NVARCHAR(50),
            DayOfWeek NVARCHAR(50),
            Target INT,
            Actual INT,
            Date DATE,
            Shift NVARCHAR(50),
            ReasonCode NVARCHAR(50)
        )
    ";

    client
        .simple_query(create_temp_sql)
        .await
        .map_err(|e| e.to_string())?;

    let chunk_size = 200;
    for chunk in records.chunks(chunk_size) {
        let mut sql = String::from("INSERT INTO #TempDeliveryData (Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, Date, Shift, ReasonCode) VALUES ");
        let mut params: Vec<&dyn ToSql> = Vec::new();
        let mut param_idx = 1;

        for (i, rec) in chunk.iter().enumerate() {
            if i > 0 {
                sql.push_str(", ");
            }
            sql.push_str(&format!(
                "(@p{}, @p{}, @p{}, @p{}, @p{}, @p{}, CAST(@p{} AS DATE), @p{}, @p{})",
                param_idx,
                param_idx + 1,
                param_idx + 2,
                param_idx + 3,
                param_idx + 4,
                param_idx + 5,
                param_idx + 6,
                param_idx + 7,
                param_idx + 8
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

        client
            .execute(&sql, &params)
            .await
            .map_err(|e| e.to_string())?;
    }

    let insert_sql = "
        INSERT INTO dbo.DeliveryData (Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, Date, Shift, ReasonCode)
        SELECT Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, Date, Shift, ReasonCode
        FROM #TempDeliveryData
    ";

    client
        .execute(insert_sql, &[])
        .await
        .map_err(|e| e.to_string())?;

    client
        .simple_query("COMMIT TRANSACTION")
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_scorecard_week(
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
pub async fn delete_scorecard_row(
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

#[tauri::command]
pub async fn get_plan_data_preview(connection_string: String) -> Result<Vec<PlanRow>, String> {
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
            process_name: row
                .get::<&str, _>("ProcessName")
                .map(|s| s.trim().to_string()),
            qty: get_i32_robust(&row, "Qty"),
            actual: get_i32_robust(&row, "Actual"),
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
pub async fn append_plan_data(connection_string: String, records: Vec<PlanRow>) -> Result<(), String> {
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
                    &rec.process_name,
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
pub async fn delete_plan_data_by_date(connection_string: String, date: String) -> Result<(), String> {
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
pub async fn get_plan_data_for_shift(
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
            process_name: row
                .get::<&str, _>("ProcessName")
                .map(|s| s.trim().to_string()),
            qty: get_i32_robust(&row, "Qty"),
            actual: get_i32_robust(&row, "Actual"),
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

async fn ensure_reason_codes_exist(
    client: &mut tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>,
    records: &[ScorecardRow],
) -> Result<(), String> {
    let mut pairs = std::collections::HashSet::new();
    for rec in records {
        if let Some(rc) = &rec.reason_code {
            pairs.insert((rec.department.trim().to_string(), rc.clone()));
        }
    }

    for (dept, rc) in pairs {
        client
            .execute(
                "IF NOT EXISTS (SELECT 1 FROM dbo.ReasonCode WHERE ProcessName = @p1 AND ReasonCode = @p2)
                 INSERT INTO dbo.ReasonCode (ProcessName, ReasonCode) VALUES (@p1, @p2)",
                &[&dept, &rc],
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
