#!/usr/bin/env python3
"""Karin: local Codex session indexer.

Reads local Codex transcripts and writes the dataset the Karin web app consumes:
data/karin-data.json (primary) and data/karin-data.js (window.KARIN_DATA wrapper,
for drag-drop / backward compatibility).
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CODEX_HOME = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
KARIN_HOME = Path(__file__).resolve().parents[1]
DATA_DIR = KARIN_HOME / "data"
DATA_JSON = DATA_DIR / "karin-data.json"
DATA_JS = DATA_DIR / "karin-data.js"


SECRET_PATTERNS = [
    (re.compile(r"(?i)(api[_-]?key|access[_-]?token|secret|password)(\s*[:=]\s*)(['\"]?)[^\s'\";,]+"), r"\1\2\3[redacted]"),
    (re.compile(r"\b(sk-[A-Za-z0-9_-]{16,})\b"), "[redacted-openai-key]"),
]


def iso_from_timestamp(raw: str | None) -> str | None:
    if not raw:
        return None
    return raw


def redact(text: str) -> str:
    for pattern, replacement in SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def load_thread_names() -> dict[str, str]:
    index_path = CODEX_HOME / "session_index.jsonl"
    names: dict[str, str] = {}
    if not index_path.exists():
        return names
    with index_path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            session_id = item.get("id")
            if session_id:
                names[session_id] = item.get("thread_name") or session_id
    return names


def iter_session_files() -> list[Path]:
    roots = [CODEX_HOME / "sessions", CODEX_HOME / "archived_sessions"]
    files: list[Path] = []
    for root in roots:
        if root.exists():
            files.extend(root.rglob("*.jsonl"))
    return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)


def text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict):
            text = item.get("text") or item.get("input_text") or item.get("output_text")
            if text:
                parts.append(str(text))
    return "\n".join(parts)


def text_from_reasoning(payload: dict[str, Any]) -> str:
    summary = payload.get("summary") or []
    text = text_from_content(summary)
    if text:
        return text
    encrypted = payload.get("encrypted_content")
    if encrypted:
        return f"Encrypted reasoning content recorded by Codex; plaintext unavailable.\nEncrypted content length: {len(str(encrypted))} characters."
    return "Reasoning event recorded, but no plaintext summary was present."


def summarize_tool_name(payload: dict[str, Any]) -> str:
    if payload.get("name"):
        return str(payload["name"])
    if payload.get("namespace"):
        return str(payload["namespace"])
    action = payload.get("action")
    if isinstance(action, dict) and action.get("query"):
        return "web_search"
    return str(payload.get("type") or "tool")


def context_entry(
    timestamp: str | None,
    line_no: int,
    name: str,
    text: Any,
    source: str,
    visibility: str = "visible",
) -> dict[str, Any]:
    if not isinstance(text, str):
        text = json.dumps(text, ensure_ascii=False, indent=2)
    return {
        "timestamp": timestamp,
        "line": line_no,
        "name": name,
        "source": source,
        "visibility": visibility,
        "chars": len(text),
        "text": redact(text),
    }


def classify_context_message(text: str, role: str) -> tuple[str, str] | None:
    if role == "developer":
        return ("developer_message", "Codex/developer instruction message")
    if "# AGENTS.md instructions" in text or "<environment_context>" in text:
        return ("startup_context", "Injected startup context")
    return None


def parse_session(path: Path, names: dict[str, str]) -> dict[str, Any] | None:
    session: dict[str, Any] = {
        "id": None,
        "title": path.stem,
        "path": str(path),
        "cwd": None,
        "originator": None,
        "model": None,
        "cli_version": None,
        "started_at": None,
        "updated_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
        "messages": [],
        "tools": [],
        "reasoning": [],
        "contexts": [],
        "runtime_events": [],
        "audit": {
            "visible": [],
            "not_available": [
                {
                    "name": "hidden_openai_platform_prompts",
                    "reason": "Codex does not serialize private platform/router/safety prompts into local transcripts.",
                },
                {
                    "name": "plaintext_chain_of_thought",
                    "reason": "Reasoning payloads may contain encrypted_content; Karin can show summaries or encrypted length only.",
                },
                {
                    "name": "server_side_preprocessing",
                    "reason": "Server-side routing or request rewriting is only visible if Codex logs or exports it.",
                },
            ],
        },
        "token_events": [],
        "task_completions": [],
        "code_edits": [],
        "counts": {"user": 0, "assistant": 0, "tool_calls": 0, "tool_outputs": 0, "code_edits": 0},
        "latest_total_usage": None,
    }
    call_names: dict[str, str] = {}
    record_counts: Counter[str] = Counter()
    response_item_counts: Counter[str] = Counter()
    role_counts: Counter[str] = Counter()
    event_counts: Counter[str] = Counter()

    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line_no, line in enumerate(handle, 1):
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            timestamp = iso_from_timestamp(record.get("timestamp"))
            kind = record.get("type")
            payload = record.get("payload") or {}
            record_counts[str(kind)] += 1

            if kind == "session_meta":
                meta = payload
                session_id = meta.get("session_id") or meta.get("id")
                session["id"] = session_id
                session["title"] = names.get(session_id, session_id or session["title"])
                session["cwd"] = meta.get("cwd")
                session["originator"] = meta.get("originator")
                session["model"] = meta.get("model") or meta.get("model_provider")
                session["cli_version"] = meta.get("cli_version")
                session["started_at"] = meta.get("timestamp") or timestamp
                meta_summary = {k: v for k, v in meta.items() if k not in ("base_instructions", "dynamic_tools")}
                session["contexts"].append(context_entry(timestamp, line_no, "session_meta_summary", meta_summary, "Codex session_meta"))
                if meta.get("base_instructions") is not None:
                    session["contexts"].append(context_entry(timestamp, line_no, "base_instructions", meta.get("base_instructions"), "Codex session_meta.base_instructions"))
                if meta.get("dynamic_tools") is not None:
                    session["contexts"].append(context_entry(timestamp, line_no, "dynamic_tools", meta.get("dynamic_tools"), "Codex session_meta.dynamic_tools"))
                continue

            if kind == "turn_context":
                session["model"] = payload.get("model") or session["model"]
                session["cwd"] = payload.get("cwd") or session["cwd"]
                session["contexts"].append(context_entry(timestamp, line_no, "turn_context", payload, "Codex runtime turn_context"))
                continue

            if kind == "event_msg":
                event_type = payload.get("type")
                event_counts[str(event_type)] += 1
                if event_type == "token_count":
                    info = payload.get("info") or {}
                    token_event = {
                        "timestamp": timestamp,
                        "line": line_no,
                        "last": info.get("last_token_usage"),
                        "total": info.get("total_token_usage"),
                        "context_window": info.get("model_context_window"),
                        "rate_limits": payload.get("rate_limits"),
                    }
                    session["token_events"].append(token_event)
                    session["latest_total_usage"] = token_event.get("total")
                elif event_type == "task_complete":
                    session["task_completions"].append(
                        {
                            "timestamp": timestamp,
                            "turn_id": payload.get("turn_id"),
                            "duration_ms": payload.get("duration_ms"),
                            "time_to_first_token_ms": payload.get("time_to_first_token_ms"),
                        }
                    )
                elif event_type == "patch_apply_end":
                    call_id = payload.get("call_id")
                    patch_event = {
                        "timestamp": timestamp,
                        "line": line_no,
                        "call_id": call_id,
                        "success": payload.get("success"),
                        "status": payload.get("status"),
                        "changes": payload.get("changes"),
                        "stdout": redact(str(payload.get("stdout") or "")),
                        "stderr": redact(str(payload.get("stderr") or "")),
                    }
                    for edit in reversed(session["code_edits"]):
                        if edit.get("call_id") == call_id:
                            edit["result"] = patch_event
                            break
                    continue
                elif event_type not in ("agent_message", "user_message"):
                    session["runtime_events"].append(
                        {
                            "timestamp": timestamp,
                            "line": line_no,
                            "type": event_type,
                            "text": redact(json.dumps(payload, ensure_ascii=False, indent=2)),
                        }
                    )
                continue

            if kind != "response_item":
                continue

            item_type = payload.get("type")
            response_item_counts[str(item_type)] += 1
            if item_type == "message":
                role = payload.get("role") or "unknown"
                role_counts[str(role)] += 1
                text = redact(text_from_content(payload.get("content")))
                phase = payload.get("phase")
                context_kind = classify_context_message(text, role)
                if context_kind:
                    name, source = context_kind
                    session["contexts"].append(context_entry(timestamp, line_no, name, text, source))
                if role in ("user", "assistant") or phase in ("commentary", "final"):
                    session["messages"].append(
                        {
                            "timestamp": timestamp,
                            "line": line_no,
                            "role": role,
                            "phase": phase,
                            "text": text,
                        }
                    )
                    if role == "user":
                        session["counts"]["user"] += 1
                    elif role == "assistant":
                        session["counts"]["assistant"] += 1

            elif item_type == "reasoning":
                session["reasoning"].append(
                    {
                        "timestamp": timestamp,
                        "line": line_no,
                        "id": payload.get("id"),
                        "text": redact(text_from_reasoning(payload)),
                    }
                )

            elif item_type in ("function_call", "web_search_call", "custom_tool_call", "tool_search_call"):
                tool_name = summarize_tool_name(payload)
                call_id = payload.get("call_id") or payload.get("id")
                if call_id:
                    call_names[str(call_id)] = tool_name
                raw_args = payload.get("arguments") or payload.get("input") or payload.get("action") or ""
                if not isinstance(raw_args, str):
                    raw_args = json.dumps(raw_args, ensure_ascii=False, indent=2)
                raw_args = redact(raw_args)
                tool = {
                    "timestamp": timestamp,
                    "line": line_no,
                    "call_id": call_id,
                    "name": tool_name,
                    "arguments": raw_args,
                    "output": None,
                }
                session["tools"].append(tool)
                session["counts"]["tool_calls"] += 1
                if tool_name == "apply_patch" or "apply_patch" in raw_args or "*** Begin Patch" in raw_args:
                    session["code_edits"].append(
                        {
                            "timestamp": timestamp,
                            "line": line_no,
                            "call_id": call_id,
                            "name": tool_name,
                            "patch": raw_args,
                            "result": None,
                        }
                    )

            elif item_type in ("function_call_output", "custom_tool_call_output", "tool_search_output"):
                call_id = payload.get("call_id")
                output = redact(str(payload.get("output") or ""))
                for tool in reversed(session["tools"]):
                    if tool.get("call_id") == call_id and tool.get("output") is None:
                        tool["output"] = output
                        break
                else:
                    session["tools"].append(
                        {
                            "timestamp": timestamp,
                            "line": line_no,
                            "call_id": call_id,
                            "name": call_names.get(str(call_id), "tool_output"),
                            "arguments": "",
                            "output": output,
                        }
                    )
                session["counts"]["tool_outputs"] += 1

    if not session["id"]:
        match = re.search(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})", path.name)
        session["id"] = match.group(1) if match else path.stem
        session["title"] = names.get(session["id"], session["title"])
    session["counts"]["code_edits"] = len(session["code_edits"])
    session["counts"]["contexts"] = len(session["contexts"])
    session["counts"]["reasoning"] = len(session["reasoning"])
    session["counts"]["runtime_events"] = len(session["runtime_events"])
    session["audit"]["visible"] = [
        {"name": "chat_messages", "count": len(session["messages"]), "source": "response_item.message"},
        {"name": "context_blocks", "count": len(session["contexts"]), "source": "session_meta, turn_context, developer/startup messages"},
        {"name": "reasoning_records", "count": len(session["reasoning"]), "source": "response_item.reasoning summaries/encrypted markers"},
        {"name": "tool_calls", "count": len(session["tools"]), "source": "function/custom/web/tool_search calls"},
        {"name": "token_events", "count": len(session["token_events"]), "source": "event_msg.token_count"},
        {"name": "runtime_events", "count": len(session["runtime_events"]), "source": "non-message event_msg records"},
    ]
    session["audit"]["record_counts"] = dict(record_counts)
    session["audit"]["response_item_counts"] = dict(response_item_counts)
    session["audit"]["role_counts"] = dict(role_counts)
    session["audit"]["event_counts"] = dict(event_counts)
    return session


def build_payload(limit: int | None) -> dict[str, Any]:
    names = load_thread_names()
    files = iter_session_files()
    if limit:
        files = files[:limit]
    sessions = []
    for path in files:
        parsed = parse_session(path, names)
        if parsed:
            sessions.append(parsed)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "codex_home": str(CODEX_HOME),
        "session_count": len(sessions),
        "sessions": sessions,
    }


def write_data(payload: dict[str, Any]) -> None:
    """Write both the plain-JSON dataset (primary) and the JS wrapper (drag-drop)."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False)
    DATA_JSON.write_text(text, encoding="utf-8")
    DATA_JS.write_text("window.KARIN_DATA = " + text + ";\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Index local Codex sessions for the Karin web app.")
    parser.add_argument("--limit", type=int, default=None, help="Index only the newest N sessions.")
    args = parser.parse_args()

    payload = build_payload(args.limit)
    write_data(payload)
    print(f"Karin indexed {payload['session_count']} sessions")
    print(f"JSON: {DATA_JSON}")
    print(f"JS:   {DATA_JS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
