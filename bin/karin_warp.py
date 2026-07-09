#!/usr/bin/env python3
"""Karin: local Warp terminal agent-session indexer.

Reads Warp's local SQLite database and writes the dataset the Karin web app
consumes for Warp sessions: data/warp-raw.json (primary) and data/warp-status.json.
Mirrors bin/karin.py (Codex) and bin/karin_claude.py (Claude): argparse CLI,
recursive secret redaction, --watch loop, UTF-8 writes, dist/data copy.

Why this exists: Warp runs agents against custom model endpoints (the owner's
DeepSeek v4-flash / v4-pro API keys) as well as Warp's built-in models. Those runs
are invisible to the Codex and Claude indexers, but Warp records them locally.

Source of truth (Windows):
  %LOCALAPPDATA%/warp/Warp/data/warp.sqlite

Tables used:
  agent_conversations  one row per conversation; conversation_data is JSON holding
                       per-model token totals, agent_name, run_id, context usage.
  ai_queries           one row per typed prompt: text, working dir, status, ts.
  agent_tasks          one row per task; `task` is a raw protobuf BLOB holding the
                       assistant messages, reasoning, tool calls and tool results.

The protobuf has no shipped schema, so we walk the wire format generically
(see decode_fields). Field numbers were derived by inspecting live data; the ones
we are confident about are named in EVENT_KINDS / TOOL_FIELDS, and everything else
is preserved verbatim in each record's `tree` for the app's Raw tab. Nothing is
dropped just because we could not name it.

Read-only by design: Warp keeps warp.sqlite open in WAL mode, so we snapshot the
db/-wal/-shm trio to a temp dir and read the copy. Warp is never written to, and
never locked.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


KARIN_HOME = Path(__file__).resolve().parents[1]
DATA_DIR = KARIN_HOME / "data"
DATA_JSON = DATA_DIR / "warp-raw.json"
DATA_STATUS = DATA_DIR / "warp-status.json"
DIST_DATA_DIR = KARIN_HOME / "dist" / "data"

MAX_STRING_CHARS = 8000
DEFAULT_LIMIT = 40

# Same redaction rules as the Claude indexer, plus DeepSeek-style keys — Warp tool
# results embed raw terminal output, which is the most likely place a key leaks.
SECRET_PATTERNS = [
    (re.compile(r"(?i)(api[_-]?key|access[_-]?token|secret|password)(\s*[:=]\s*)(['\"]?)[^\s'\";,]+"), r"\1\2\3[redacted]"),
    (re.compile(r"\b(sk-[A-Za-z0-9_-]{16,})\b"), "[redacted-openai-key]"),
    (re.compile(r"\b(sk-ant-[A-Za-z0-9_-]{16,})\b"), "[redacted-anthropic-key]"),
]


def default_db_path() -> Path:
    """Warp's SQLite path per platform. WARP_DB overrides."""
    env = os.environ.get("WARP_DB")
    if env:
        return Path(env)
    home = Path.home()
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
        return base / "warp" / "Warp" / "data" / "warp.sqlite"
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "dev.warp.Warp-Stable" / "warp.sqlite"
    return home / ".local" / "state" / "warp-terminal" / "warp.sqlite"


WARP_DB = default_db_path()


def redact(text: str) -> str:
    for pattern, replacement in SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def clean_value(value: Any) -> Any:
    """Recursively redact secrets and truncate over-long strings (never drop)."""
    if isinstance(value, str):
        text = redact(value)
        if len(text) > MAX_STRING_CHARS:
            original = len(text)
            text = text[:MAX_STRING_CHARS] + f"…[truncated {original} chars]"
        return text
    if isinstance(value, list):
        return [clean_value(item) for item in value]
    if isinstance(value, dict):
        return {key: clean_value(item) for key, item in value.items()}
    return value


# ---------------------------------------------------------------------------
# Protobuf wire-format decoding (no schema available)
# ---------------------------------------------------------------------------

def read_varint(buf: bytes, pos: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        if pos >= len(buf):
            raise ValueError("truncated varint")
        byte = buf[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return result, pos


def decode_fields(buf: bytes) -> Iterator[tuple[int, int, Any]]:
    """Yield (field_number, wire_type, payload) for one protobuf message.

    Stops silently at the first malformed byte: these blobs embed base64 and other
    opaque payloads, and a partial read is far more useful than an exception.
    """
    pos, size = 0, len(buf)
    while pos < size:
        try:
            key, pos = read_varint(buf, pos)
        except ValueError:
            return
        field, wire = key >> 3, key & 7
        if wire == 0:
            try:
                value, pos = read_varint(buf, pos)
            except ValueError:
                return
            yield field, wire, value
        elif wire == 2:
            try:
                length, pos = read_varint(buf, pos)
            except ValueError:
                return
            if length < 0 or pos + length > size:
                return
            yield field, wire, buf[pos:pos + length]
            pos += length
        elif wire == 5:
            if pos + 4 > size:
                return
            yield field, wire, buf[pos:pos + 4]
            pos += 4
        elif wire == 1:
            if pos + 8 > size:
                return
            yield field, wire, buf[pos:pos + 8]
            pos += 8
        else:
            return


def as_text(raw: bytes) -> str | None:
    """Decode a length-delimited payload as text, or None if it isn't."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if text and all(ch.isprintable() or ch in "\n\r\t" for ch in text):
        return text
    return None


def field_map(buf: bytes) -> dict[int, Any]:
    """First occurrence of each field, for the fixed-shape messages we know."""
    out: dict[int, Any] = {}
    for field, _wire, value in decode_fields(buf):
        out.setdefault(field, value)
    return out


def to_tree(buf: bytes, depth: int = 0) -> Any:
    """Generic decode into JSON-safe nesting. Repeated fields become lists.

    This is what backs the Raw tab: every field we could not name survives here
    under its wire field number (`f7`, `f25`, …).
    """
    if depth > 8:
        return f"<{len(buf)} bytes>"
    out: dict[str, Any] = {}
    seen = False
    for field, wire, value in decode_fields(buf):
        seen = True
        key = f"f{field}"
        if wire == 2:
            text = as_text(value)
            nested = to_tree(value, depth + 1) if len(value) > 1 else None
            if text is not None and (nested is None or len(text) > 3):
                node: Any = text
            elif nested is not None:
                node = nested
            else:
                node = f"<{len(value)} bytes>"
        elif wire == 0:
            node = value
        else:
            node = f"<{len(value)}b fixed>"
        if key in out:
            if not isinstance(out[key], list):
                out[key] = [out[key]]
            out[key].append(node)
        else:
            out[key] = node
    if not seen:
        return as_text(buf) or f"<{len(buf)} bytes>"
    return out


def collect_strings(value: Any, acc: list[str] | None = None) -> list[str]:
    """Every text leaf in a decoded tree, in order. Used for tool output text."""
    if acc is None:
        acc = []
    if isinstance(value, str):
        if not value.startswith("<") and len(value.strip()) > 1:
            acc.append(value)
    elif isinstance(value, dict):
        for item in value.values():
            collect_strings(item, acc)
    elif isinstance(value, list):
        for item in value:
            collect_strings(item, acc)
    return acc


def timestamp_message(buf: bytes) -> str | None:
    """google.protobuf.Timestamp {1: seconds, 2: nanos} → ISO-8601 Z."""
    fields = field_map(buf)
    seconds = fields.get(1)
    if not isinstance(seconds, int):
        return None
    nanos = fields.get(2) if isinstance(fields.get(2), int) else 0
    moment = datetime.fromtimestamp(seconds + nanos / 1e9, tz=timezone.utc)
    return moment.isoformat().replace("+00:00", "Z")


def db_timestamp(value: str | None) -> str | None:
    """Warp stores naive UTC strings ('2026-07-09 11:14:53[.ffffff]')."""
    if not value:
        return None
    text = value.strip().replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            moment = datetime.strptime(text[:26], fmt)
        except ValueError:
            continue
        return moment.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    return None


# ---------------------------------------------------------------------------
# Event grammar (field numbers verified against live data)
# ---------------------------------------------------------------------------

# agent_tasks.task → f1 task_id, f5 (repeated) event.
# Inside an event: f1 uuid, f11 task_id, f13 turn_id, f14 Timestamp, and exactly
# one payload field naming the event kind:
EVENT_KINDS = {
    3: "assistant",   # {f1: markdown text}
    15: "thinking",   # {f1: reasoning text}
    4: "tool_call",   # {f1: call_id, f<tool>: args}
    5: "tool_result", # {f1: call_id, f<tool>: result, f11: env context}
    8: "citation",
    6: "event_f6",
    16: "event_f16",
}

# Tool identity is the payload field number inside a tool_call / tool_result.
# Named where the payload made it unambiguous; the rest keep their field number
# so the Raw tab still shows them rather than hiding an unknown tool.
TOOL_FIELDS = {
    2: "run_command",
    5: "read_files",
    6: "apply_file_diff",
    15: "file_glob",
    23: "precmd",
    26: "read_file",
    30: "task_report",
    35: "spawn_subagent",
}

EDIT_TOOLS = {"apply_file_diff"}

# Tool-call ids reveal which provider produced the call.
CALL_ID_PROVIDERS = (("toolu_", "anthropic"), ("call_", "openai-compatible"))


def call_provider(call_id: str | None) -> str | None:
    if not call_id:
        return None
    for prefix, provider in CALL_ID_PROVIDERS:
        if call_id.startswith(prefix):
            return provider
    return None


def tool_from_payload(payload: dict[int, Any]) -> tuple[str, Any]:
    """Pick the tool field out of a tool_call/tool_result body.

    f1 is the call id and f11 is the environment context; every other
    length-delimited field is the tool payload itself.
    """
    for field, value in payload.items():
        if field in (1, 7, 11, 13, 14):
            continue
        if not isinstance(value, bytes):
            continue
        name = TOOL_FIELDS.get(field, f"tool_f{field}")
        return name, to_tree(value)
    return "unknown", None


def env_context(payload: dict[int, Any]) -> dict[str, Any] | None:
    """f11 on a tool_result: cwd, OS, shell, git branch."""
    raw = payload.get(11)
    if not isinstance(raw, bytes):
        return None
    tree = to_tree(raw)
    if not isinstance(tree, dict):
        return None
    cwd = None
    first = tree.get("f1")
    if isinstance(first, str):
        cwd = first.strip("\n").split("\x12")[0].lstrip("\n.") or None
    return {"cwd": cwd, "tree": tree}


def decode_event(blob: bytes) -> dict[str, Any] | None:
    payload = field_map(blob)
    uuid = as_text(payload[1]) if isinstance(payload.get(1), bytes) else None
    turn_id = as_text(payload[13]) if isinstance(payload.get(13), bytes) else None
    timestamp = timestamp_message(payload[14]) if isinstance(payload.get(14), bytes) else None

    kind = None
    for field, name in EVENT_KINDS.items():
        if field in payload:
            kind = name
            body = payload[field]
            break
    else:
        body = None

    event: dict[str, Any] = {
        "uuid": uuid,
        "turn_id": turn_id,
        "timestamp": timestamp,
        "kind": kind or "other",
        "tree": to_tree(blob),
    }

    if kind in ("assistant", "thinking") and isinstance(body, bytes):
        inner = field_map(body)
        text = as_text(inner.get(1, b"")) if isinstance(inner.get(1), bytes) else None
        event["text"] = text or ""
    elif kind in ("tool_call", "tool_result") and isinstance(body, bytes):
        inner = field_map(body)
        call_id = as_text(inner.get(1, b"")) if isinstance(inner.get(1), bytes) else None
        name, args = tool_from_payload(inner)
        event["call_id"] = call_id
        event["provider"] = call_provider(call_id)
        if kind == "tool_call":
            event["tool"] = name
            event["arguments"] = args
            event["text"] = "\n".join(collect_strings(args)[:4])
        else:
            # A result's payload field number does NOT mirror its call's, so `name`
            # here is only a hint; the real tool is resolved from call_id later.
            event["result_field"] = name
            event["text"] = "\n".join(collect_strings(args)[:6])
            env = env_context(inner)
            if env:
                event["env"] = env
    return event


def decode_task(blob: bytes) -> tuple[str | None, list[dict[str, Any]]]:
    task_id = None
    events: list[dict[str, Any]] = []
    for field, wire, value in decode_fields(blob):
        if field == 1 and wire == 2 and task_id is None:
            task_id = as_text(value)
        elif field == 5 and wire == 2:
            event = decode_event(value)
            if event:
                events.append(event)
    return task_id, events


# ---------------------------------------------------------------------------
# Conversation assembly
# ---------------------------------------------------------------------------

def snapshot_db(source: Path) -> tuple[Path, tempfile.TemporaryDirectory]:
    """Copy db + -wal + -shm so we read a consistent image and never lock Warp."""
    # ignore_cleanup_errors: on Windows the copy stays mapped for a moment after close.
    tmp = tempfile.TemporaryDirectory(prefix="karin-warp-", ignore_cleanup_errors=True)
    target = Path(tmp.name) / source.name
    shutil.copy2(source, target)
    for suffix in ("-wal", "-shm"):
        side = source.with_name(source.name + suffix)
        if side.exists():
            shutil.copy2(side, target.with_name(target.name + suffix))
    return target, tmp


def empty_usage() -> dict[str, int]:
    return {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0,
            "reasoning_output_tokens": 0, "total_tokens": 0}


def parse_conversation_data(raw: str) -> dict[str, Any]:
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return {}


def model_usage(meta: dict[str, Any]) -> list[dict[str, Any]]:
    """Per-model token totals. Warp reports ONE cumulative scalar per model per
    bucket (warp / byok / custom endpoint) — there is no input/output split, so we
    never fabricate one. `total` is the sum of the three buckets.
    """
    rows: list[dict[str, Any]] = []
    for entry in meta.get("token_usage") or []:
        warp = entry.get("warp_tokens") or 0
        byok = entry.get("byok_tokens") or 0
        custom = entry.get("custom_endpoint_tokens") or 0
        rows.append({
            "model": entry.get("model_id"),
            "warp_tokens": warp,
            "byok_tokens": byok,
            "custom_endpoint_tokens": custom,
            "total": warp + byok + custom,
            "categories": {
                "warp": entry.get("warp_token_usage_by_category") or {},
                "byok": entry.get("byok_token_usage_by_category") or {},
                "custom_endpoint": entry.get("custom_endpoint_token_usage_by_category") or {},
            },
        })
    return rows


def primary_model(rows: list[dict[str, Any]]) -> str | None:
    """The model that drove the conversation.

    Warp mixes models in one conversation: a primary agent plus small built-in
    models for tool summarization and terminal use. The primary agent is the one
    billed under the `primary_agent` category — for the owner's runs that is the
    custom DeepSeek endpoint. Fall back to the biggest token consumer.
    """
    for row in rows:
        for bucket in row["categories"].values():
            if "primary_agent" in bucket:
                return row["model"]
    if not rows:
        return None
    return max(rows, key=lambda r: r["total"])["model"]


def clean_title(text: str, limit: int = 90) -> str:
    single = " ".join((text or "").split())
    return single[:limit] + ("…" if len(single) > limit else "")


def parse_query_input(raw: str) -> dict[str, Any]:
    """ai_queries.input is a JSON array of tagged variants; we want the Query."""
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return {"text": (raw or "")[:400], "context": []}
    if isinstance(parsed, list):
        for item in parsed:
            if isinstance(item, dict) and "Query" in item:
                query = item["Query"] or {}
                return {"text": query.get("text") or "", "context": query.get("context") or []}
    return {"text": "", "context": []}


def context_bits(context: list[Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"cwd": None, "branch": None, "repo": None, "shell": None}
    for item in context:
        if not isinstance(item, dict):
            continue
        if "Directory" in item:
            out["cwd"] = (item["Directory"] or {}).get("pwd")
        elif "Git" in item:
            out["branch"] = (item["Git"] or {}).get("branch")
        elif "Repository" in item:
            repo = item["Repository"] or {}
            name, owner = repo.get("name"), repo.get("owner")
            out["repo"] = f"{owner}/{name}" if owner and name else name
        elif "ExecutionEnvironment" in item:
            env = item["ExecutionEnvironment"] or {}
            shell, version = env.get("shell_name"), env.get("shell_version")
            out["shell"] = f"{shell} {version}".strip() if shell else None
    return out


def build_conversation(
    conv_id: str,
    conv_data: str,
    last_modified: str | None,
    queries: list[sqlite3.Row],
    tasks: list[tuple[str, bytes]],
) -> dict[str, Any]:
    meta_all = parse_conversation_data(conv_data)
    meta = meta_all.get("conversation_usage_metadata") or {}
    usage_rows = model_usage(meta)
    model = primary_model(usage_rows)
    models = [row["model"] for row in usage_rows if row["model"]]

    # --- prompts (ai_queries) ---
    messages: list[dict[str, Any]] = []
    cwd = branch = repo = shell = None
    for row in queries:
        parsed = parse_query_input(row["input"])
        bits = context_bits(parsed["context"])
        cwd = cwd or bits["cwd"] or row["working_directory"]
        branch = branch or bits["branch"]
        repo = repo or bits["repo"]
        shell = shell or bits["shell"]
        status = (row["output_status"] or "").strip('"') or None
        messages.append({
            "timestamp": db_timestamp(row["start_ts"]),
            "role": "user",
            "text": parsed["text"],
            "status": status,
            "exchange_id": row["exchange_id"],
            "model_id": row["model_id"] or None,
            "cwd": bits["cwd"] or row["working_directory"],
        })

    # --- agent events (agent_tasks protobuf) ---
    events: list[dict[str, Any]] = []
    for task_id, blob in tasks:
        _decoded_id, decoded = decode_task(blob)
        for event in decoded:
            event["task_id"] = task_id
            events.append(event)

    for event in events:
        env = event.get("env")
        if env and env.get("cwd") and not cwd:
            cwd = env["cwd"]

    # A tool_result carries no reliable tool identity of its own — name it after the
    # tool_call that shares its call_id.
    tool_by_call = {e["call_id"]: e.get("tool") for e in events
                    if e["kind"] == "tool_call" and e.get("call_id")}
    for event in events:
        if event["kind"] == "tool_result":
            event["tool"] = tool_by_call.get(event.get("call_id")) or event.get("result_field") or "unknown"

    # --- merge into one timeline ---
    # ai_queries and agent_tasks use different id spaces (exchange_id vs turn_id),
    # so ordering is by timestamp; `line` is the position in that merged order.
    timeline: list[dict[str, Any]] = []
    for message in messages:
        timeline.append({"_kind": "message", **message})
    for event in events:
        timeline.append({"_kind": event["kind"], **event})
    timeline.sort(key=lambda item: (item.get("timestamp") or "", item.get("_kind") != "message"))
    for index, item in enumerate(timeline):
        item["line"] = index

    # `records` is the full-fidelity feed for the Raw tab: every event, `tree` intact.
    # The structured arrays below are lean views onto it — `arguments` lives in the
    # tree already, so carrying it twice would double the payload for nothing.
    records = [clean_value({"_line": item["line"], "_type": item["_kind"],
                            **{k: v for k, v in item.items() if k not in ("arguments", "_kind", "line")}})
               for item in timeline]

    # The structured arrays deliberately match the Codex shapes in src/types.ts
    # (Message / Tool / Reasoning / CodeEdit) so the unified cycle builder and the
    # event renderer treat a Warp session like any other, with no new item types.
    # Read from `timeline`, not the source lists: only the timeline copies carry `line`.
    prompts = [i for i in timeline if i["_kind"] == "message"]
    assistant = [i for i in timeline if i["_kind"] == "assistant"]
    thinking = [i for i in timeline if i["_kind"] == "thinking"]
    tool_calls = [i for i in timeline if i["_kind"] == "tool_call"]
    tool_results = [i for i in timeline if i["_kind"] == "tool_result"]
    edits = [i for i in tool_calls if i.get("tool") in EDIT_TOOLS]
    subagents = [i for i in tool_calls if i.get("tool") == "spawn_subagent"]

    results_by_call = {i.get("call_id"): i for i in tool_results if i.get("call_id")}

    out_messages = [{
        "timestamp": m["timestamp"], "line": m["line"], "role": m["role"],
        "phase": None, "text": m["text"],
    } for m in prompts] + [{
        "timestamp": a["timestamp"], "line": a["line"], "role": "assistant",
        "phase": "final", "text": a.get("text", ""),
    } for a in assistant]
    out_messages.sort(key=lambda m: m["line"])

    reasoning = [{
        "timestamp": t["timestamp"], "line": t["line"], "text": t.get("text", ""),
    } for t in thinking]

    tools = [{
        "timestamp": call["timestamp"],
        "line": call["line"],
        "call_id": call.get("call_id"),
        "name": call.get("tool") or "unknown",
        "arguments": call.get("text") or "",
        "output": (results_by_call.get(call.get("call_id")) or {}).get("text"),
        "provider": call.get("provider"),
    } for call in tool_calls]

    timestamps = [i["timestamp"] for i in timeline if i.get("timestamp")]
    started_at = min(timestamps) if timestamps else None
    updated_at = db_timestamp(last_modified) or (max(timestamps) if timestamps else None)

    agent_name = meta_all.get("agent_name")
    first_prompt = next((m["text"] for m in messages if m["text"].strip()), "")
    title = clean_title(agent_name or first_prompt or conv_id[:8])

    total_tokens = sum(row["total"] for row in usage_rows)
    usage = empty_usage()
    usage["total_tokens"] = total_tokens

    type_counts = Counter(item["_kind"] for item in timeline)

    return clean_value({
        "id": conv_id,
        "title": title,
        "first_prompt": first_prompt,
        "agent_name": agent_name,
        "run_id": meta_all.get("run_id"),
        "parent_conversation_id": meta_all.get("parent_conversation_id"),
        "harness": meta_all.get("orchestration_harness_type"),
        "started_at": started_at,
        "updated_at": updated_at,
        "model": model,
        "models": models,
        "cwd": cwd,
        "gitBranch": branch,
        "repo": repo,
        "shell": shell,
        "context_window_usage": meta.get("context_window_usage"),
        "credits_spent": meta.get("credits_spent"),
        "was_summarized": meta.get("was_summarized"),
        "model_usage": usage_rows,
        "tool_usage_metadata": meta.get("tool_usage_metadata") or {},
        "latest_total_usage": usage,
        "record_count": len(records),
        "type_counts": dict(type_counts),
        "records": records,
        "messages": out_messages,
        "reasoning": reasoning,
        "tools": tools,
        # Warp reports one cumulative token scalar per model per conversation, never a
        # per-turn frame, so there is nothing to put here and no per-cycle usage bar.
        "token_events": [],
        "contexts": [],
        "runtime_events": [],
        "code_edits": [{
            "line": e["line"], "timestamp": e["timestamp"], "call_id": e.get("call_id"),
            "name": e.get("tool") or "apply_file_diff", "patch": e.get("text") or "", "result": None,
        } for e in edits],
        "subagents": [{
            "line": s["line"], "timestamp": s["timestamp"],
            "description": (s.get("text") or "").split("\n")[0],
        } for s in subagents],
        "prompt_statuses": [m.get("status") for m in messages],
        "counts": {
            "user": len(messages),
            "assistant": len(assistant),
            "tool_calls": len(tool_calls),
            "tool_outputs": len(tool_results),
            "code_edits": len(edits),
            "reasoning": len(thinking),
            "contexts": 0,
            "usage_frames": 0,
            "subagents": len(subagents),
        },
    })


def read_conversations(db: Path, limit: int, only: str | None) -> list[dict[str, Any]]:
    snapshot, tmp = snapshot_db(db)
    con = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)
    try:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT conversation_id, conversation_data, last_modified_at "
            "FROM agent_conversations ORDER BY last_modified_at DESC"
        ).fetchall()

        queries: dict[str, list[sqlite3.Row]] = {}
        for row in con.execute("SELECT * FROM ai_queries ORDER BY start_ts"):
            queries.setdefault(row["conversation_id"], []).append(row)

        tasks: dict[str, list[tuple[str, bytes]]] = {}
        for row in con.execute("SELECT conversation_id, task_id, task FROM agent_tasks ORDER BY id"):
            tasks.setdefault(row["conversation_id"], []).append((row["task_id"], row["task"]))

        out: list[dict[str, Any]] = []
        for row in rows:
            if limit and len(out) >= limit:
                break
            conv_id = row["conversation_id"]
            conversation = build_conversation(
                conv_id, row["conversation_data"], row["last_modified_at"],
                queries.get(conv_id, []), tasks.get(conv_id, []),
            )
            if only and only.lower() not in json.dumps(conversation.get("models", [])).lower():
                continue
            out.append(conversation)
        return out
    finally:
        con.close()
        tmp.cleanup()


def build_status(db: Path, conversations: list[dict[str, Any]]) -> dict[str, Any]:
    stamps = [c["updated_at"] for c in conversations if c.get("updated_at")]
    return {
        "last_checked_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "last_entry_at": max(stamps) if stamps else None,
        "session_file_count": len(conversations),
        "warp_db": str(db),
    }


def build_payload(db: Path, conversations: list[dict[str, Any]], status: dict[str, Any]) -> dict[str, Any]:
    return {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "warp_db": str(db),
        "session_count": len(conversations),
        **status,
        "conversations": conversations,
    }


def write_data(payload: dict[str, Any], status: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATA_JSON.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    DATA_STATUS.write_text(json.dumps(status, ensure_ascii=False), encoding="utf-8")
    if DIST_DATA_DIR.exists():
        DIST_DATA_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(DATA_JSON, DIST_DATA_DIR / DATA_JSON.name)
        shutil.copy2(DATA_STATUS, DIST_DATA_DIR / DATA_STATUS.name)


def index_once(db: Path, limit: int, only: str | None, quiet: bool = False) -> int:
    if not db.exists():
        if not quiet:
            print(f"warp: no database at {db} — skipping (is Warp installed?)", file=sys.stderr)
        return 0
    conversations = read_conversations(db, limit, only)
    status = build_status(db, conversations)
    write_data(build_payload(db, conversations, status), status)
    if not quiet:
        events = sum(c["record_count"] for c in conversations)
        models = sorted({m for c in conversations for m in c["models"]})
        print(f"warp: {len(conversations)} conversations, {events} events → {DATA_JSON}")
        print(f"warp: models {', '.join(models) or '(none)'}")
    return len(conversations)


def db_fingerprint(db: Path) -> tuple[float, int]:
    """mtime+size across db and -wal: Warp writes the WAL first."""
    total_mtime = 0.0
    total_size = 0
    for suffix in ("", "-wal"):
        path = db.with_name(db.name + suffix)
        if path.exists():
            stat = path.stat()
            total_mtime = max(total_mtime, stat.st_mtime)
            total_size += stat.st_size
    return total_mtime, total_size


def main() -> int:
    parser = argparse.ArgumentParser(description="Index local Warp agent conversations for Karin.")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT,
                        help=f"Index only the newest N conversations (default {DEFAULT_LIMIT}).")
    parser.add_argument("--all", action="store_true", help="Index every conversation (overrides --limit).")
    parser.add_argument("--model", type=str, default=None, help="Only conversations using a model matching this substring.")
    parser.add_argument("--db", type=str, default=None, help="Path to warp.sqlite (default: platform location).")
    parser.add_argument("--watch", action="store_true", help="Keep indexing while Warp writes new activity.")
    parser.add_argument("--interval", type=float, default=5.0, help="Watch polling interval in seconds.")
    args = parser.parse_args()

    db = Path(args.db) if args.db else WARP_DB
    limit = 0 if args.all else max(0, args.limit)

    index_once(db, limit, args.model)
    if not args.watch:
        return 0

    last = db_fingerprint(db)
    while True:
        time.sleep(args.interval)
        current = db_fingerprint(db)
        if current != last:
            last = current
            try:
                index_once(db, limit, args.model, quiet=True)
            except Exception as error:  # keep the watcher alive across Warp's writes
                print(f"warp: reindex failed: {error}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
