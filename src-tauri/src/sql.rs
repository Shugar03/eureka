//! SQL in the code console (AC-171): runs the learner's script on a fresh
//! in-memory SQLite (built into Eureka: nothing to install), one statement at
//! a time. Queries print as tables; the first error stops the script and says
//! on which line it was. `assert(condición, 'mensaje')` makes exercises'
//! tests possible. A time limit interrupts runaway queries (a recursive CTE).

use crate::runner::{RunResult, MAX_OUTPUT};
use anyhow::{anyhow, Result};
use rusqlite::fallible_iterator::FallibleIterator;
use rusqlite::functions::FunctionFlags;
use rusqlite::types::ValueRef;
use rusqlite::{Batch, Connection};
use std::time::Duration;

/// Rows shown per query; the rest is counted.
pub const MAX_ROWS: usize = 200;

/// The line (1-based) where byte `offset` of `code` is.
fn line_at(code: &str, offset: usize) -> usize {
    code[..offset.min(code.len())].matches('\n').count() + 1
}

fn cell(v: ValueRef) -> String {
    match v {
        ValueRef::Null => "NULL".into(),
        ValueRef::Integer(i) => i.to_string(),
        ValueRef::Real(f) => f.to_string(),
        ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(),
        ValueRef::Blob(b) => format!("<{} bytes>", b.len()),
    }
}

/// A plain-text table, padded by characters (accents count as one).
pub fn table(columns: &[String], rows: &[Vec<String>], more: usize) -> String {
    let width = |s: &str| s.chars().count();
    let widths: Vec<usize> = (0..columns.len()).map(|i| rows.iter().map(|r| width(&r[i])).chain([width(&columns[i])]).max().unwrap_or(0).min(60)).collect();
    let line = |cells: &[String]| {
        cells
            .iter()
            .zip(&widths)
            .map(|(c, w)| {
                let c: String = c.chars().take(60).collect();
                format!("{c}{}", " ".repeat(w.saturating_sub(width(&c))))
            })
            .collect::<Vec<_>>()
            .join(" | ")
            .trim_end()
            .to_string()
    };
    let mut out = format!("{}\n{}\n", line(columns), widths.iter().map(|w| "-".repeat(*w)).collect::<Vec<_>>().join("-+-"));
    for r in rows {
        out.push_str(&line(r));
        out.push('\n');
    }
    let total = rows.len() + more;
    out.push_str(&match (total, more) {
        (1, _) => "(1 fila)\n".to_string(),
        (n, 0) => format!("({n} filas)\n"),
        (n, m) => format!("({n} filas; no se muestran las últimas {m})\n"),
    });
    out
}

fn with_assert(conn: &Connection) -> rusqlite::Result<()> {
    conn.create_scalar_function("assert", -1, FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC, |ctx| {
        let ok = match ctx.get_raw(0) {
            ValueRef::Integer(i) => i != 0,
            ValueRef::Real(f) => f != 0.0,
            _ => false,
        };
        if ok {
            return Ok(1i64);
        }
        let msg = if ctx.len() > 1 { cell(ctx.get_raw(1)) } else { "la condición no se cumple".into() };
        Err(rusqlite::Error::UserFunctionError(format!("falló: {msg}").into()))
    })
}

/// stdout, stderr and whether it ended well, for the whole script.
fn execute(conn: &Connection, code: &str) -> (String, String, bool) {
    let mut out = String::new();
    let mut batch = Batch::new(conn, code);
    // Where the next statement starts looking for its own text (for the line).
    let mut cursor = 0;
    loop {
        let stmt = match batch.next() {
            Ok(Some(s)) => s,
            Ok(None) => return (out, String::new(), true),
            Err(e) => return (out, format!("Error en la línea {}: {e}\n", line_at(code, cursor + leading_space(&code[cursor..]))), false),
        };
        let mut stmt = stmt;
        let text = stmt.expanded_sql().unwrap_or_default();
        let start = code[cursor..].find(text.trim()).map(|i| cursor + i).unwrap_or(cursor);
        cursor = start + text.trim().len();
        let line = line_at(code, start);
        let columns: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
        let result = if columns.is_empty() {
            stmt.raw_execute().map(|_| ())
        } else {
            let mut rows = Vec::new();
            let mut more = 0;
            let mut q = stmt.raw_query();
            let r = loop {
                match q.next() {
                    Ok(Some(row)) if rows.len() < MAX_ROWS => rows.push((0..columns.len()).map(|i| row.get_ref(i).map(cell).unwrap_or_default()).collect()),
                    Ok(Some(_)) => more += 1,
                    Ok(None) => break Ok(()),
                    Err(e) => break Err(e),
                }
            };
            if r.is_ok() {
                out.push_str(&table(&columns, &rows, more));
                out.push('\n');
            }
            r
        };
        if let Err(e) = result {
            let msg = match &e {
                rusqlite::Error::SqliteFailure(_, Some(m)) => m.clone(),
                other => other.to_string(),
            };
            return (out, format!("Error en la línea {line}: {msg}\n"), false);
        }
        if out.len() > MAX_OUTPUT {
            out.truncate(MAX_OUTPUT);
            out.push_str("\n[…salida recortada]");
            return (out, String::new(), true);
        }
    }
}

fn leading_space(s: &str) -> usize {
    s.len() - s.trim_start().len()
}

pub async fn run(code: &str, limit: Duration) -> Result<RunResult> {
    let conn = Connection::open_in_memory().map_err(|e| anyhow!("no pude abrir SQLite: {e}"))?;
    with_assert(&conn).map_err(|e| anyhow!("no pude preparar SQLite: {e}"))?;
    let stop = conn.get_interrupt_handle();
    let code = code.to_string();
    let job = tokio::task::spawn_blocking(move || execute(&conn, &code));
    match tokio::time::timeout(limit, job).await {
        Ok(joined) => {
            let (stdout, stderr, ok) = joined.map_err(|e| anyhow!("SQLite se cortó: {e}"))?;
            Ok(RunResult { stdout, stderr, exit_code: Some(if ok { 0 } else { 1 }), timed_out: false, compile_error: false, duration_ms: 0 })
        }
        Err(_) => {
            stop.interrupt();
            Ok(RunResult { stdout: String::new(), stderr: String::new(), exit_code: None, timed_out: true, compile_error: false, duration_ms: 0 })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_script_creates_inserts_and_queries() {
        let r = run("CREATE TABLE alumnos (nombre TEXT, nota INTEGER);\nINSERT INTO alumnos VALUES ('Ana', 9), ('Íñigo', 7);\nSELECT nombre, nota FROM alumnos ORDER BY nota DESC;", Duration::from_secs(5)).await.unwrap();
        assert_eq!(r.exit_code, Some(0), "{}", r.stderr);
        assert_eq!(r.stdout, "nombre | nota\n-------+-----\nAna    | 9\nÍñigo  | 7\n(2 filas)\n\n");
    }

    #[tokio::test]
    async fn errors_say_on_which_line() {
        let r = run("CREATE TABLE t (x INTEGER);\n\nSELECT y FROM t;\nSELECT 1;", Duration::from_secs(5)).await.unwrap();
        assert_eq!(r.exit_code, Some(1));
        assert!(r.stderr.starts_with("Error en la línea 3: no such column: y"), "{}", r.stderr);
        let r = run("SELECT 1;\nSELEC 2;", Duration::from_secs(5)).await.unwrap();
        assert!(r.stderr.starts_with("Error en la línea 2:") && r.stdout.contains("(1 fila)"), "{}", r.stderr);
    }

    #[tokio::test]
    async fn assert_makes_tests_possible() {
        let tests = "SELECT assert((SELECT count(*) FROM t) = 2, 'deben quedar 2 filas');";
        let r = run(&format!("CREATE TABLE t (x);\nINSERT INTO t VALUES (1);\n{tests}"), Duration::from_secs(5)).await.unwrap();
        assert!(r.exit_code == Some(1) && r.stderr.contains("falló: deben quedar 2 filas"), "{}", r.stderr);
        let r = run(&format!("CREATE TABLE t (x);\nINSERT INTO t VALUES (1), (2);\n{tests}"), Duration::from_secs(5)).await.unwrap();
        assert_eq!(r.exit_code, Some(0), "{}", r.stderr);
    }

    #[tokio::test]
    async fn big_results_and_runaway_queries_are_capped() {
        let r = run("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500) SELECT i FROM n;", Duration::from_secs(5)).await.unwrap();
        assert!(r.stdout.contains("(500 filas; no se muestran las últimas 300)"), "{}", r.stdout);
        let started = std::time::Instant::now();
        let r = run("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n;", Duration::from_millis(500)).await.unwrap();
        assert!(r.timed_out && started.elapsed() < Duration::from_secs(3));
    }
}
