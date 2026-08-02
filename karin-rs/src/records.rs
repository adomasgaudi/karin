//! One JSONL line → one inspectable record.
//!
//! Ported from karin's `RecordRow.tsx`: transcripts vary a lot in shape, so the
//! one-line preview is pulled defensively rather than from a rigid schema. A
//! line that isn't JSON is still a record — it just previews as itself.

use serde_json::Value;

#[derive(Clone)]
pub struct Record {
    pub line: usize,
    pub value: Option<Value>,
    /// `user`, `assistant`, `response_item/message`, … — the row's chip.
    pub kind: String,
    pub preview: String,
    pub timestamp: Option<String>,
}

pub fn parse_line(line_no: usize, text: &str) -> Record {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Record {
            line: line_no,
            value: None,
            kind: "blank".into(),
            preview: String::new(),
            timestamp: None,
        };
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return Record {
            line: line_no,
            value: None,
            kind: "text".into(),
            preview: one_line(trimmed, 160),
            timestamp: None,
        };
    };
    Record {
        line: line_no,
        kind: kind_of(&value),
        preview: one_line(&preview_of(&value), 160),
        timestamp: value
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_owned),
        value: Some(value),
    }
}

/// Codex nests the interesting type one level down, so show both.
fn kind_of(v: &Value) -> String {
    let base = v.get("type").and_then(Value::as_str).unwrap_or("record");
    match v
        .get("payload")
        .and_then(|p| p.get("type"))
        .and_then(Value::as_str)
    {
        Some(sub) => format!("{base}/{sub}"),
        None => base.to_owned(),
    }
}

// ------------------------------------------------------------------ preview

/// The first human-readable text in a `content` field, whatever shape it took.
fn first_text(content: &Value) -> Option<String> {
    match content {
        Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
        Value::Array(blocks) => blocks.iter().find_map(|b| {
            if let Some(t) = b
                .get("text")
                .and_then(Value::as_str)
                .filter(|t| !t.trim().is_empty())
            {
                return Some(t.to_owned());
            }
            if let Some(t) = b
                .get("thinking")
                .and_then(Value::as_str)
                .filter(|t| !t.trim().is_empty())
            {
                return Some(t.to_owned());
            }
            match b.get("type").and_then(Value::as_str) {
                Some("tool_use") => b
                    .get("name")
                    .and_then(Value::as_str)
                    .map(|n| format!("→ {n}")),
                Some("tool_result") => b.get("content").and_then(|c| match c {
                    Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
                    other => first_text(other),
                }),
                _ => None,
            }
        }),
        _ => None,
    }
}

/// Codex stores everything under `payload`, keyed by its own `type`.
fn codex_preview(payload: &Value) -> Option<String> {
    let kind = payload.get("type").and_then(Value::as_str).unwrap_or("");
    let role = || {
        payload
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("message")
            .to_owned()
    };

    if kind == "message" {
        return Some(
            first_text(payload.get("content")?).unwrap_or_else(|| format!("{} message", role())),
        );
    }
    if kind == "reasoning" {
        let summary = payload.get("summary").and_then(first_text);
        return Some(summary.unwrap_or_else(|| {
            if payload.get("encrypted_content").is_some() {
                "encrypted reasoning".into()
            } else {
                "reasoning".into()
            }
        }));
    }
    if kind.ends_with("_call") {
        let name = payload
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_else(|| kind.trim_end_matches("_call"));
        let args = payload
            .get("arguments")
            .or_else(|| payload.get("input"))
            .or_else(|| payload.get("action"));
        let text = args.map(flatten).unwrap_or_default();
        return Some(if text.is_empty() {
            format!("→ {name}")
        } else {
            format!("→ {name} {text}")
        });
    }
    if kind.ends_with("_output") {
        let text = payload.get("output").map(flatten).unwrap_or_default();
        return Some(if text.is_empty() {
            kind.replace('_', " ")
        } else {
            text
        });
    }
    (!kind.is_empty()).then(|| kind.replace('_', " "))
}

fn flatten(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn preview_of(v: &Value) -> String {
    if let Some(text) = v
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(first_text)
    {
        return text;
    }
    if let Some(s) = v.get("summary").and_then(Value::as_str) {
        return s.to_owned();
    }
    if let Some(content) = v.get("content") {
        if let Some(text) = first_text(content) {
            return text;
        }
    }
    if let Some(text) = v
        .get("payload")
        .filter(|p| p.is_object())
        .and_then(codex_preview)
    {
        return text;
    }
    // Warp events carry a flat `text` plus the tool that produced it.
    if let Some(text) = v
        .get("text")
        .and_then(Value::as_str)
        .filter(|t| !t.trim().is_empty())
    {
        return match v.get("tool").and_then(Value::as_str) {
            Some(tool) => format!("→ {tool} {text}"),
            None => text.to_owned(),
        };
    }
    // Never blank: fall back to the record's own shape.
    let Some(obj) = v.as_object() else {
        return flatten(v);
    };
    if obj.is_empty() {
        return "(empty)".into();
    }
    let keys: Vec<&str> = obj.keys().take(6).map(String::as_str).collect();
    let more = if obj.len() > 6 { ", …" } else { "" };
    format!("{{ {}{more} }}", keys.join(", "))
}

pub fn one_line(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    crate::meta::truncate(&flat, max)
}
