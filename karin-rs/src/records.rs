//! One JSONL line → one inspectable record.
//!
//! Ported from karin's `RecordRow.tsx`: transcripts vary a lot in shape, so the
//! one-line preview is pulled defensively rather than from a rigid schema. A
//! line that isn't JSON is still a record — it just previews as itself.

use serde_json::Value;

/// What a record *is*, as opposed to what its `type` field calls itself.
///
/// The two matter separately. Both harnesses replay tool output under the
/// `user` role, and both inject context — reminders, file snapshots, queue
/// bookkeeping — into the same stream as the owner's typed prompts. Reading a
/// transcript means telling those apart, so the judgement is made once here and
/// every view shares it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Shape {
    /// A prompt the human actually typed.
    User,
    /// Context the harness wrote under the user's name.
    Injected,
    Assistant,
    Thinking,
    ToolCall,
    ToolResult,
    /// Bookkeeping the transcript needs and a reader does not.
    Noise,
    Other,
}

impl Shape {
    /// The label a reader sees, rather than the record's own `type`.
    pub fn label(self) -> &'static str {
        match self {
            Shape::User => "you",
            Shape::Injected => "context",
            Shape::Assistant => "ai",
            Shape::Thinking => "thinking",
            Shape::ToolCall => "tool",
            Shape::ToolResult => "result",
            Shape::Noise => "meta",
            Shape::Other => "record",
        }
    }

    /// Rows the clean view drops entirely.
    pub fn is_chatter(self) -> bool {
        matches!(self, Shape::Noise | Shape::Injected | Shape::Other)
    }
}

#[derive(Clone)]
pub struct Record {
    pub line: usize,
    pub value: Option<Value>,
    /// `user`, `assistant`, `response_item/message`, … — the row's chip.
    pub kind: String,
    pub shape: Shape,
    pub preview: String,
    /// Full untruncated text, kept only for the shapes a reader reads whole.
    /// Tool traffic and bookkeeping leave this empty rather than doubling the
    /// memory cost of an eight-megabyte transcript.
    pub body: String,
    pub timestamp: Option<String>,
}

pub fn parse_line(line_no: usize, text: &str) -> Record {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Record {
            line: line_no,
            value: None,
            kind: "blank".into(),
            shape: Shape::Noise,
            preview: String::new(),
            body: String::new(),
            timestamp: None,
        };
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return Record {
            line: line_no,
            value: None,
            kind: "text".into(),
            shape: Shape::Other,
            preview: one_line(trimmed, 160),
            body: String::new(),
            timestamp: None,
        };
    };
    let shape = classify(&value);
    Record {
        line: line_no,
        kind: kind_of(&value),
        shape,
        preview: one_line(&preview_of(&value), 160),
        body: match shape {
            Shape::User | Shape::Assistant | Shape::Thinking => body_of(&value),
            _ => String::new(),
        },
        timestamp: value
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_owned),
        value: Some(value),
    }
}

// --------------------------------------------------------------- classifying

/// Records that exist so the harness can resume a session, not so anyone can
/// read one. Both sources grew these over time; an unknown one falls through to
/// the role checks below rather than being hidden.
const BOOKKEEPING: &[&str] = &[
    "attachment",
    "last-prompt",
    "ai-title",
    "queue-operation",
    "file-history-snapshot",
    "session_meta",
    "turn_context",
    "event_msg/token_count",
    "system",
];

pub fn classify(v: &Value) -> Shape {
    let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
    if BOOKKEEPING.contains(&kind) {
        return Shape::Noise;
    }

    // Codex keeps the real record one level down, under `payload`.
    if let Some(payload) = v.get("payload").filter(|p| p.is_object()) {
        let sub = payload.get("type").and_then(Value::as_str).unwrap_or("");
        if BOOKKEEPING.contains(&format!("{kind}/{sub}").as_str()) {
            return Shape::Noise;
        }
        return match sub {
            "user_message" => user_or_injected(payload.get("message")),
            "reasoning" => Shape::Thinking,
            "message" => match payload.get("role").and_then(Value::as_str) {
                Some("user") => user_or_injected(payload.get("content")),
                Some("assistant") => Shape::Assistant,
                _ => Shape::Noise,
            },
            s if s.ends_with("_call") => Shape::ToolCall,
            s if s.ends_with("_output") => Shape::ToolResult,
            "agent_message" | "agent_reasoning" => Shape::Assistant,
            _ => Shape::Other,
        };
    }

    let Some(message) = v.get("message") else {
        return Shape::Other;
    };
    let content = message.get("content");
    match message.get("role").and_then(Value::as_str).unwrap_or(kind) {
        // Claude replays every tool result as a `user` turn. Only a turn with
        // no tool_result block in it was actually typed by a person.
        "user" if has_block(content, "tool_result") => Shape::ToolResult,
        "user" => user_or_injected(content),
        // A turn may carry prose *and* a tool call or a thought. The prose is
        // the part a reader came for, so it wins whenever it is present.
        "assistant" if has_block(content, "text") => Shape::Assistant,
        "assistant" if has_block(content, "thinking") => Shape::Thinking,
        "assistant" if has_block(content, "tool_use") => Shape::ToolCall,
        "assistant" => Shape::Assistant,
        _ => Shape::Other,
    }
}

/// A prompt whose only text is a `<system-reminder>` or similar envelope was
/// written by the harness, not the owner.
fn user_or_injected(content: Option<&Value>) -> Shape {
    let Some(text) = content.map(collect_text) else {
        return Shape::Injected;
    };
    let first = text.trim_start();
    if first.is_empty() || first.starts_with('<') {
        return Shape::Injected;
    }
    Shape::User
}

fn has_block(content: Option<&Value>, kind: &str) -> bool {
    let Some(Value::Array(blocks)) = content else {
        return false;
    };
    blocks
        .iter()
        .any(|b| b.get("type").and_then(Value::as_str) == Some(kind))
}

/// Every text block joined, for the views that show a message whole.
fn collect_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => {
            let parts: Vec<String> = blocks
                .iter()
                .filter_map(|b| {
                    let key = match b.get("type").and_then(Value::as_str) {
                        Some("thinking") => "thinking",
                        Some("text") | Some("input_text") | Some("output_text") | None => "text",
                        _ => return None,
                    };
                    b.get(key)
                        .and_then(Value::as_str)
                        .filter(|t| !t.trim().is_empty())
                        .map(str::to_owned)
                })
                .collect();
            parts.join("\n\n")
        }
        _ => String::new(),
    }
}

fn body_of(v: &Value) -> String {
    if let Some(content) = v.get("message").and_then(|m| m.get("content")) {
        return collect_text(content);
    }
    if let Some(payload) = v.get("payload") {
        if let Some(msg) = payload.get("message").and_then(Value::as_str) {
            return clean_envelope(msg);
        }
        if let Some(content) = payload.get("content") {
            let text = collect_text(content);
            if !text.is_empty() {
                return text;
            }
        }
        if let Some(summary) = payload.get("summary") {
            return collect_text(summary);
        }
    }
    v.get("content").map(collect_text).unwrap_or_default()
}

/// Codex wraps a typed prompt in an attachment header; the request is the part
/// the owner wrote.
fn clean_envelope(s: &str) -> String {
    match s.split_once("## My request for Codex:") {
        Some((_, request)) => request.trim().to_owned(),
        None => s.trim().to_owned(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn shape(v: serde_json::Value) -> Shape {
        classify(&v)
    }

    #[test]
    fn a_replayed_tool_result_is_not_a_prompt() {
        // Claude writes tool output back into the stream as a `user` turn.
        assert_eq!(
            shape(json!({
                "type": "user",
                "message": { "role": "user", "content": [
                    { "type": "tool_result", "content": "Compiling karin-rs v0.1.0" }
                ]}
            })),
            Shape::ToolResult
        );
    }

    #[test]
    fn injected_context_is_not_a_prompt() {
        assert_eq!(
            shape(json!({
                "type": "user",
                "message": { "role": "user", "content": [
                    { "type": "text", "text": "<system-reminder>be nice</system-reminder>" }
                ]}
            })),
            Shape::Injected
        );
        assert_eq!(
            shape(json!({
                "type": "user",
                "message": { "role": "user", "content": [
                    { "type": "text", "text": "how much faster is it now?" }
                ]}
            })),
            Shape::User
        );
    }

    #[test]
    fn prose_beats_a_tool_call_in_the_same_turn() {
        assert_eq!(
            shape(json!({
                "type": "assistant",
                "message": { "role": "assistant", "content": [
                    { "type": "text", "text": "Reading the file." },
                    { "type": "tool_use", "name": "Read" }
                ]}
            })),
            Shape::Assistant
        );
        assert_eq!(
            shape(json!({
                "type": "assistant",
                "message": { "role": "assistant", "content": [
                    { "type": "tool_use", "name": "Read" }
                ]}
            })),
            Shape::ToolCall
        );
    }

    #[test]
    fn bookkeeping_is_recognised_on_both_sources() {
        for kind in [
            "attachment",
            "ai-title",
            "queue-operation",
            "file-history-snapshot",
        ] {
            assert_eq!(shape(json!({ "type": kind })), Shape::Noise, "{kind}");
        }
        assert_eq!(shape(json!({ "type": "session_meta" })), Shape::Noise);
    }

    #[test]
    fn codex_payloads_classify() {
        assert_eq!(
            shape(json!({ "type": "response_item", "payload": {
                "type": "message", "role": "assistant",
                "content": [{ "type": "output_text", "text": "done" }]
            }})),
            Shape::Assistant
        );
        assert_eq!(
            shape(json!({ "type": "response_item", "payload": { "type": "reasoning" }})),
            Shape::Thinking
        );
        assert_eq!(
            shape(
                json!({ "type": "response_item", "payload": { "type": "function_call", "name": "shell" }})
            ),
            Shape::ToolCall
        );
        assert_eq!(
            shape(json!({ "type": "response_item", "payload": { "type": "function_call_output" }})),
            Shape::ToolResult
        );
        assert_eq!(
            shape(json!({ "type": "event_msg", "payload": {
                "type": "user_message", "message": "## My request for Codex:\nship it"
            }})),
            Shape::User
        );
    }

    #[test]
    fn a_codex_prompt_loses_its_envelope() {
        // `r##` because the JSON itself contains a `"#`.
        let rec = parse_line(
            1,
            r##"{"type":"event_msg","payload":{"type":"user_message","message":"# Files mentioned\nx.rs\n\n## My request for Codex:\nship it"}}"##,
        );
        assert_eq!(rec.shape, Shape::User);
        assert_eq!(rec.body, "ship it");
    }
}
