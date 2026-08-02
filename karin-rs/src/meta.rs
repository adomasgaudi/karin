//! What a session file calls itself: the project it ran in, and its first
//! human prompt. Both live inside the JSONL, so we read only the head — a
//! transcript can be hundreds of megabytes and the answer is in the first page.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::Value;

/// Enough for the session header plus the opening exchange.
const HEAD_BYTES: u64 = 512 * 1024;
const MAX_LINES: usize = 600;
const TITLE_CHARS: usize = 72;

#[derive(Clone, Default)]
pub struct Meta {
    pub cwd: Option<PathBuf>,
    pub title: Option<String>,
}

pub fn read(path: &Path) -> Meta {
    let mut meta = Meta::default();
    let Ok(file) = File::open(path) else { return meta };

    let mut buf = Vec::new();
    if file.take(HEAD_BYTES).read_to_end(&mut buf).is_err() {
        return meta;
    }
    let text = String::from_utf8_lossy(&buf);

    for line in text.lines().take(MAX_LINES) {
        // JSON parsing dominates the cost, so only pay it on candidate lines.
        let wants_cwd = meta.cwd.is_none() && line.contains("\"cwd\"");
        let wants_title = meta.title.is_none() && line.contains("\"role\":\"user\"");
        if !wants_cwd && !wants_title {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };

        if wants_cwd {
            meta.cwd = find_cwd(&v).map(PathBuf::from);
        }
        if wants_title {
            meta.title = find_title(&v);
        }
        if meta.cwd.is_some() && meta.title.is_some() {
            break;
        }
    }
    meta
}

/// Claude puts `cwd` on every record; Codex puts it in `session_meta.payload`.
fn find_cwd(v: &Value) -> Option<String> {
    let s = v
        .get("cwd")
        .or_else(|| v.get("payload").and_then(|p| p.get("cwd")))?
        .as_str()?;
    (!s.is_empty()).then(|| s.to_owned())
}

/// The first prompt a human actually typed — Claude nests it under `message`,
/// Codex under `payload`. Tool results and injected context are not titles.
fn find_title(v: &Value) -> Option<String> {
    let body = v.get("message").or_else(|| v.get("payload"))?;
    if body.get("role")?.as_str()? != "user" {
        return None;
    }
    match body.get("content")? {
        Value::String(s) => clean(s),
        Value::Array(items) => items.iter().find_map(|item| {
            let kind = item.get("type").and_then(Value::as_str).unwrap_or("");
            if kind != "text" && kind != "input_text" {
                return None; // tool_result, image, …
            }
            clean(item.get("text")?.as_str()?)
        }),
        _ => None,
    }
}

/// One tidy line. Anything opening with `<` is injected context
/// (`<system-reminder>`, `<user_instructions>`), never a title.
fn clean(s: &str) -> Option<String> {
    let line = s.lines().map(str::trim).find(|l| !l.is_empty())?;
    if line.starts_with('<') {
        return None;
    }
    Some(truncate(line, TITLE_CHARS))
}

pub fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_owned();
    }
    let head: String = s.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", head.trim_end())
}
