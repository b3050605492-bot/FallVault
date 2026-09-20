use serde::Deserialize;
use sqlx::{Sqlite, SqlitePool, Transaction};
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Deserialize)]
pub struct RekeyEntry {
    id: i64,
    before: [Option<String>; 5],
    after: [String; 5],
}

#[derive(Deserialize)]
pub struct RekeyHistory {
    id: i64,
    before: String,
    after: String,
}

#[derive(Deserialize)]
pub struct RekeyAttachment {
    id: i64,
    before: String,
    after: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RekeyPayload {
    old_salt: String,
    old_verifier: String,
    salt: String,
    verifier: String,
    entries: Vec<RekeyEntry>,
    history: Vec<RekeyHistory>,
    attachments: Vec<RekeyAttachment>,
}

#[derive(Deserialize)]
pub struct RecoveryEntry {
    id: i64,
    title: String,
    before: [Option<String>; 5],
    after: [Option<String>; 5],
}

#[derive(Deserialize)]
pub struct RecoveryPayload {
    entries: Vec<RecoveryEntry>,
}

fn require_match(actual: u64, expected: usize) -> Result<(), String> {
    if actual != expected as u64 {
        return Err("保险库在修改主密码期间发生了变化，请重新解锁后重试".into());
    }
    Ok(())
}

async fn apply_rekey(tx: &mut Transaction<'_, Sqlite>, data: &RekeyPayload) -> Result<(), String> {
    // Compare the complete snapshot: an inserted/deleted/edited row must abort rotation.
    // The first write also acquires SQLite's writer lock before checking the rows.
    for (key, before, after) in [
        ("master_salt", &data.old_salt, &data.salt),
        ("master_verifier", &data.old_verifier, &data.verifier),
    ] {
        let result = sqlx::query("UPDATE fly_meta SET value = ? WHERE key = ? AND value = ?")
            .bind(after)
            .bind(key)
            .bind(before)
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
        require_match(result.rows_affected(), 1)?;
    }
    for (table, count) in [
        ("entries", data.entries.len()),
        ("password_history", data.history.len()),
        ("attachments", data.attachments.len()),
    ] {
        let actual: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
        require_match(actual as u64, count)?;
    }
    for row in &data.entries {
        let mut query = sqlx::query(
            "UPDATE entries SET username = ?, password = ?, notes = ?, totp_secret = ?, custom_fields = ? \
             WHERE id = ? AND username IS ? AND password IS ? AND notes IS ? AND totp_secret IS ? AND custom_fields IS ?"
        );
        for value in &row.after {
            query = query.bind(value);
        }
        query = query.bind(row.id);
        for value in &row.before {
            query = query.bind(value);
        }
        require_match(
            query
                .execute(&mut **tx)
                .await
                .map_err(|e| e.to_string())?
                .rows_affected(),
            1,
        )?;
    }
    for row in &data.history {
        let result = sqlx::query(
            "UPDATE password_history SET old_password = ? WHERE id = ? AND old_password = ?",
        )
        .bind(&row.after)
        .bind(row.id)
        .bind(&row.before)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
        require_match(result.rows_affected(), 1)?;
    }
    for row in &data.attachments {
        let result =
            sqlx::query("UPDATE attachments SET file_path = ? WHERE id = ? AND file_path = ?")
                .bind(&row.after)
                .bind(row.id)
                .bind(&row.before)
                .execute(&mut **tx)
                .await
                .map_err(|e| e.to_string())?;
        require_match(result.rows_affected(), 1)?;
    }
    Ok(())
}

async fn commit_rekey(pool: &SqlitePool, data: &RekeyPayload) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    if let Err(error) = apply_rekey(&mut tx, data).await {
        tx.rollback()
            .await
            .map_err(|e| format!("{error}; rollback failed: {e}"))?;
        return Err(error);
    }
    tx.commit().await.map_err(|e| e.to_string())
}

// Use one real transaction on one pooled connection; separate JS BEGIN/UPDATE calls
// can be assigned to different connections by the SQL plugin.
#[tauri::command]
pub async fn commit_master_password_change(
    db: String,
    data: RekeyPayload,
    instances: tauri::State<'_, DbInstances>,
) -> Result<(), String> {
    let pool = {
        let pools = instances.0.read().await;
        let Some(DbPool::Sqlite(pool)) = pools.get(&db) else {
            return Err("Vault database is not loaded".into());
        };
        pool.clone()
    };
    commit_rekey(&pool, &data).await
}

async fn apply_recovery(
    tx: &mut Transaction<'_, Sqlite>,
    data: &RecoveryPayload,
) -> Result<(), String> {
    if data.entries.is_empty() {
        return Err("没有可恢复的异常字段".into());
    }
    for row in &data.entries {
        let mut query = sqlx::query(
            "UPDATE entries SET username = ?, password = ?, notes = ?, totp_secret = ?, custom_fields = ?, \
             updated_at = datetime('now', 'localtime') \
             WHERE id = ? AND title = ? AND username IS ? AND password IS ? AND notes IS ? \
             AND totp_secret IS ? AND custom_fields IS ?",
        );
        for value in &row.after {
            query = query.bind(value);
        }
        query = query.bind(row.id).bind(&row.title);
        for value in &row.before {
            query = query.bind(value);
        }
        if query
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?
            .rows_affected()
            != 1
        {
            return Err(format!(
                "账号“{}”在恢复期间发生了变化，请重新检查后重试",
                row.title
            ));
        }
    }
    Ok(())
}

async fn commit_recovery(pool: &SqlitePool, data: &RecoveryPayload) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    if let Err(error) = apply_recovery(&mut tx, data).await {
        tx.rollback()
            .await
            .map_err(|e| format!("{error}; rollback failed: {e}"))?;
        return Err(error);
    }
    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn commit_entry_recovery(
    db: String,
    data: RecoveryPayload,
    instances: tauri::State<'_, DbInstances>,
) -> Result<(), String> {
    let pool = {
        let pools = instances.0.read().await;
        let Some(DbPool::Sqlite(pool)) = pools.get(&db) else {
            return Err("Vault database is not loaded".into());
        };
        pool.clone()
    };
    commit_recovery(&pool, &data).await
}

