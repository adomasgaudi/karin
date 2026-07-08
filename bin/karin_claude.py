#!/usr/bin/env python3
"""Karin: local Claude Code session indexer.

Reads local Claude Code transcripts (JSON Lines) and writes the dataset the Karin
web app consumes for Claude sessions: data/claude-raw.json (primary) and
data/claude-status.json. Mirrors the structure/style of bin/karin.py (the Codex
indexer): argparse CLI, recursive secret redaction, --watch loop, UTF-8 writes,
and a dist/data copy when a built bundle exists.

Source layout:
  CLAUDE_HOME/projects/<project-slug>/<session-uuid>.jsonl
where <project-slug> is a filesystem path with separators replaced by "-".
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", Path.home() / ".claude"))
PROJECTS_DIR = CLAUDE_HOME / "projects"
KARIN_HOME = Path(__file__).resolve().parents[1]
DATA_DIR = KARIN_HOME / "data"
DATA_JSON = DATA_DIR / "claude-raw.json"
DATA_STATUS = DATA_DIR / "claude-status.json"
DIST_DATA_DIR = KARIN_HOME / "dist" / "data"

# Truncate any single string value longer than this (keeps giant attachments /
# deferred_tools_delta payloads from bloating the dataset).
MAX_STRING_CHARS = 8000

# Default: index only the newest N session files globally (by mtime).
DEFAULT_LIMIT = 40


SECRET_PATTERNS = [
    (re.compile(r"(?i)(api[_-]?key|access[_-]?token|secret|password)(\s*[:=]\s*)(['\"]?)[^\s'\";,]+"), r"\1\2\3[redacted]"),
    (re.compile(r"\b(sk-[A-Za-z0-9_-]{16,})\b"), "[redacted-openai-key]"),
    (re.compile(r"\b(sk-ant-[A-Za-z0-9_-]{16,})\b"), "[redacted-anthropic-key]"),
]


def redact(text: str) -> str:
    for pattern, replacement in SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def clean_value(value: Any) -> Any:
    """Recursively redact secrets and truncate over-long strings in-place-ish.

    Strings longer than MAX_STRING_CHARS are truncated (never dropped) with a
    trailing marker recording the original length.
    """
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


def iso_from_mtime(mtime: float) -> str | None:
    if not mtime:
        return None
    return datetime.fromtimestamp(mtime, timezone.utc).isoformat()


def iter_session_files() -> list[Path]:
    """All transcript files under every project dir, sorted newest mtime first."""
    if not PROJECTS_DIR.exists():
        return []
    files = list(PROJECTS_DIR.glob("*/*.jsonl"))
    return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)


def message_text(content: Any) -> str:
    """Flatten a message.content (string, or list of blocks) to plain text."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text")
            if text:
                parts.append(str(text))
    return "\n".join(parts)


def is_human_prompt(record: dict[str, Any]) -> bool:
    """A real human user turn: a non-sidechain user record with text content."""
    if record.get("type") != "user":
        return False
    if record.get("isSidechain"):
        return False
    message = record.get("message")
    if not isinstance(message, dict) or message.get("role") != "user":
        return False
    # Tool results arrive as user records with a list of tool_result blocks and
    # no human text; those are not prompts.
    return bool(message_text(message.get("content")).strip())


# --- Usage normalization (Claude usage obj -> shared TokenUsage) ---------------
# Canonical mapping used everywhere. Codex objects never set the cache_creation_*
# fields, so downstream splitUsage defaults them to 0 and stays byte-identical.

def _int(value: Any) -> int:
    return int(value) if isinstance(value, (int, float)) else 0


def empty_usage() -> dict[str, int]:
    return {
        "input_tokens": 0,
        "cached_input_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_creation_5m_input_tokens": 0,
        "cache_creation_1h_input_tokens": 0,
        "output_tokens": 0,
        "reasoning_output_tokens": 0,
        "total_tokens": 0,
    }


def normalize_usage(usage: dict[str, Any]) -> dict[str, int]:
    """Map a raw Claude message.usage object to the shared TokenUsage shape."""
    cache_read = _int(usage.get("cache_read_input_tokens"))
    fresh_input = _int(usage.get("input_tokens"))
    cache_create = _int(usage.get("cache_creation_input_tokens"))
    creation = usage.get("cache_creation") or {}
    create_5m = _int(creation.get("ephemeral_5m_input_tokens"))
    create_1h = _int(creation.get("ephemeral_1h_input_tokens"))
    output = _int(usage.get("output_tokens"))
    return {
        # input_tokens folds cache_read in so splitUsage freshInput = claude.input_tokens
        "input_tokens": fresh_input + cache_read,
        "cached_input_tokens": cache_read,
        # cache_creation stays its own violet bucket (premium write), NOT folded into input
        "cache_creation_input_tokens": cache_create,
        "cache_creation_5m_input_tokens": create_5m,
        "cache_creation_1h_input_tokens": create_1h,
        # thinking tokens are already included in Claude's output_tokens
        "output_tokens": output,
        "reasoning_output_tokens": 0,
        "total_tokens": fresh_input + cache_read + cache_create + output,
    }


def add_usage(acc: dict[str, int], part: dict[str, int]) -> dict[str, int]:
    return {key: acc.get(key, 0) + part.get(key, 0) for key in empty_usage()}


# --- Tool / edit result helpers ------------------------------------------------

def result_text_from_content(content: Any) -> str:
    """Extract plain text from a tool_result block's content (str or block list)."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return "" if content is None else json.dumps(content, ensure_ascii=False)
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        btype = block.get("type")
        if btype == "text" and block.get("text"):
            parts.append(str(block["text"]))
        elif btype == "image":
            parts.append("[image]")
        elif block.get("text"):
            parts.append(str(block["text"]))
    return "\n".join(parts)


def classify_result_kind(raw: Any, is_error: bool) -> str:
    if is_error:
        return "error"
    if raw is None:
        return "empty"
    if isinstance(raw, dict):
        return "object"
    if isinstance(raw, list):
        return "array"
    return "text"


def build_patch_text(structured_patch: Any) -> str:
    """Reconstruct a unified-diff-ish string from Claude's structuredPatch hunks."""
    if not isinstance(structured_patch, list):
        return ""
    out: list[str] = []
    for hunk in structured_patch:
        if not isinstance(hunk, dict):
            continue
        out.append(
            f"@@ -{hunk.get('oldStart', 0)},{hunk.get('oldLines', 0)}"
            f" +{hunk.get('newStart', 0)},{hunk.get('newLines', 0)} @@"
        )
        for ln in hunk.get("lines") or []:
            out.append(str(ln))
    return "\n".join(out)


EDIT_TOOL_NAMES = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


def build_attribution(mcp_servers: set[str], mcp_tools: set[str],
                      skills: set[str], plugins: set[str]) -> dict[str, list[str]] | None:
    """Best-effort attribution derived from tool usage (Claude has no explicit field)."""
    if not (mcp_servers or mcp_tools or skills or plugins):
        return None
    return {
        "mcp_server": sorted(mcp_servers),
        "mcp_tool": sorted(mcp_tools),
        "skill": sorted(skills),
        "plugin": sorted(plugins),
    }


def read_records(path: Path) -> tuple[list[tuple[int, dict[str, Any]]], int]:
    """Read a transcript into an ordered (line_no, record) list plus a parse-error count."""
    raw: list[tuple[int, dict[str, Any]]] = []
    parse_errors = 0
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line_no, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                parse_errors += 1
                continue
            if not isinstance(record, dict):
                parse_errors += 1
                continue
            raw.append((line_no, record))
    return raw, parse_errors


# Records whose content becomes a "context" card (everything not a message / tool).
CONTEXT_TYPES = {
    "system", "attachment", "mode", "permission-mode", "bridge-session",
    "file-history-snapshot", "queue-operation", "last-prompt", "ai-title",
}


def context_from_record(line_no: int, rtype: str, record: dict[str, Any]) -> dict[str, Any]:
    """Build a context card from a non-message/non-tool Claude record."""
    timestamp = record.get("timestamp")
    subtype: str | None = None
    attachment_type: str | None = None
    name = rtype
    source = f"claude.{rtype}"
    payload: Any = record

    if rtype == "system":
        subtype = record.get("subtype")
        name = f"system/{subtype}" if subtype else "system"
    elif rtype == "attachment":
        att = record.get("attachment") or {}
        attachment_type = att.get("type")
        name = f"attachment/{attachment_type}" if attachment_type else "attachment"
        payload = att
    elif rtype == "mode":
        name = f"mode/{record.get('mode')}"
    elif rtype == "permission-mode":
        name = f"permission-mode/{record.get('permissionMode')}"
    elif rtype == "bridge-session":
        name = "bridge-session"
    elif rtype == "file-history-snapshot":
        name = "file-history-snapshot"
        payload = record.get("snapshot") or record
    elif rtype == "queue-operation":
        name = f"queue/{record.get('operation')}"
        payload = record.get("content") or record
    elif rtype == "last-prompt":
        name = "last-prompt"
        payload = record.get("lastPrompt") or record
    elif rtype == "ai-title":
        name = "ai-title"
        payload = record.get("aiTitle") or record

    if isinstance(payload, str):
        text = redact(payload)
    else:
        text = redact(json.dumps(payload, ensure_ascii=False, indent=2))
    if len(text) > MAX_STRING_CHARS:
        text = text[:MAX_STRING_CHARS] + f"…[truncated {len(text)} chars]"

    return {
        "line": line_no,
        "timestamp": timestamp,
        "name": name,
        "source": source,
        "visibility": "visible",
        "chars": len(text),
        "text": text,
        "subtype": subtype,
        "attachment_type": attachment_type,
        "raw": clean_value(payload),
    }


def enrich_session(path: Path, slug: str, include_subagents: bool = True) -> dict[str, Any]:
    """Parse a Claude transcript into the enriched session shape.

    Keeps the existing raw outputs (records[], type_counts, usage_totals) intact and
    adds the structured views (messages, thinking, tools, code_edits, usage_frames,
    contexts, turn_contexts, subagents, counts, audit, latest_total_usage).
    """
    raw_records, parse_errors = read_records(path)
    mtime = path.stat().st_mtime

    # --- existing raw summary (unchanged behavior) ---------------------------
    records: list[dict[str, Any]] = []
    type_counts: Counter[str] = Counter()
    model_counts: Counter[str] = Counter()
    usage_totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "total_tokens": 0,
    }
    ai_title: str | None = None
    first_prompt = ""
    started_at: str | None = None
    last_version: str | None = None
    last_git_branch: str | None = None
    last_cwd: str | None = None

    # --- enriched accumulators ----------------------------------------------
    messages: list[dict[str, Any]] = []
    thinking: list[dict[str, Any]] = []
    tools: list[dict[str, Any]] = []
    code_edits: list[dict[str, Any]] = []
    usage_frames: list[dict[str, Any]] = []
    contexts: list[dict[str, Any]] = []
    turn_contexts: list[dict[str, Any]] = []
    tool_by_id: dict[str, dict[str, Any]] = {}
    edit_by_id: dict[str, dict[str, Any]] = {}
    running_total = empty_usage()
    latest_total_usage: dict[str, int] | None = None
    last_model: str | None = None

    content_block_counts: Counter[str] = Counter()
    role_counts: Counter[str] = Counter()
    system_subtype_counts: Counter[str] = Counter()
    attachment_type_counts: Counter[str] = Counter()

    # Claude-only meta accumulators
    entrypoint: str | None = None
    permission_modes: list[str] = []
    service_tier: str | None = None
    speed: str | None = None
    bridge_session_id: str | None = None
    session_kind: str | None = None
    mcp_servers: set[str] = set()
    mcp_tools: set[str] = set()
    skills: set[str] = set()
    plugins: set[str] = set()

    for line_no, record in raw_records:
        rtype = str(record.get("type"))
        type_counts[rtype] += 1

        timestamp = record.get("timestamp")
        if timestamp and started_at is None:
            started_at = timestamp
        if record.get("version"):
            last_version = record.get("version")
        if record.get("gitBranch"):
            last_git_branch = record.get("gitBranch")
        if record.get("cwd"):
            last_cwd = record.get("cwd")
        if record.get("entrypoint"):
            entrypoint = str(record.get("entrypoint"))
        if record.get("sessionKind"):
            session_kind = str(record.get("sessionKind"))
        pm = record.get("permissionMode")
        if pm and pm not in permission_modes:
            permission_modes.append(str(pm))

        if rtype == "ai-title" and record.get("aiTitle"):
            ai_title = str(record.get("aiTitle"))
        if rtype == "permission-mode" and record.get("permissionMode"):
            pm2 = str(record.get("permissionMode"))
            if pm2 not in permission_modes:
                permission_modes.append(pm2)
        if rtype == "bridge-session" and record.get("bridgeSessionId"):
            bridge_session_id = str(record.get("bridgeSessionId"))
        if rtype == "system":
            system_subtype_counts[str(record.get("subtype"))] += 1
        if rtype == "attachment":
            attachment_type_counts[str((record.get("attachment") or {}).get("type"))] += 1

        if not first_prompt and is_human_prompt(record):
            first_prompt = message_text(record["message"].get("content")).strip()

        # ---- assistant records: messages, thinking, tools, edits, usage ----
        if rtype == "assistant":
            message = record.get("message")
            if isinstance(message, dict):
                model = message.get("model")
                if model:
                    model_counts[str(model)] += 1
                usage = message.get("usage")
                if isinstance(usage, dict):
                    for key in ("input_tokens", "output_tokens",
                                "cache_creation_input_tokens", "cache_read_input_tokens"):
                        val = usage.get(key)
                        if isinstance(val, (int, float)):
                            usage_totals[key] += int(val)
                    if usage.get("service_tier"):
                        service_tier = str(usage.get("service_tier"))
                    if usage.get("speed"):
                        speed = str(usage.get("speed"))

                content = message.get("content")
                blocks = content if isinstance(content, list) else []
                message_id = message.get("id")
                model_str = str(model) if model else None
                text_out = redact(message_text(content))

                # turn_context on model change
                if model_str and model_str != last_model:
                    turn_contexts.append({
                        "line": line_no, "timestamp": timestamp,
                        "model": model_str, "effort": None,
                    })
                    last_model = model_str

                # assistant message turn (always one per assistant record)
                role_counts["assistant"] += 1
                messages.append({
                    "line": line_no, "timestamp": timestamp, "role": "assistant",
                    "text": text_out, "uuid": record.get("uuid"),
                    "parent_uuid": record.get("parentUuid"), "model": model_str,
                    "stop_reason": message.get("stop_reason"), "message_id": message_id,
                    "is_sidechain": bool(record.get("isSidechain")),
                    "is_meta": bool(record.get("isMeta")),
                    "is_compact_summary": bool(record.get("isCompactSummary")),
                    "origin_kind": (record.get("origin") or {}).get("kind"),
                    "prompt_source": record.get("promptSource"),
                    "phase": None,
                })

                for idx, block in enumerate(blocks):
                    if not isinstance(block, dict):
                        continue
                    btype = block.get("type")
                    content_block_counts[str(btype)] += 1
                    if btype == "thinking":
                        thinking.append({
                            "line": line_no, "timestamp": timestamp,
                            "id": f"{message_id}:{idx}" if message_id else str(idx),
                            "text": redact(str(block.get("thinking") or "")),
                            "signature": block.get("signature"),
                            "model": model_str,
                        })
                    elif btype == "tool_use":
                        call_id = str(block.get("id"))
                        name = str(block.get("name"))
                        tinput = clean_value(block.get("input") or {})
                        caller = block.get("caller")
                        caller_val = caller.get("type") if isinstance(caller, dict) else caller
                        if name.startswith("mcp__"):
                            parts = name.split("__")
                            if len(parts) > 1:
                                mcp_servers.add(parts[1])
                            mcp_tools.add(name)
                        elif name == "Skill":
                            sk = (block.get("input") or {}).get("command") or (block.get("input") or {}).get("skill")
                            if sk:
                                skills.add(str(sk))
                        tool = {
                            "line": line_no, "timestamp": timestamp, "call_id": call_id,
                            "name": name, "input": tinput,
                            "arguments": redact(json.dumps(block.get("input") or {}, ensure_ascii=False)),
                            "caller": caller_val, "result": None, "result_line": None,
                            "is_error": False, "is_sidechain": bool(record.get("isSidechain")),
                        }
                        tools.append(tool)
                        tool_by_id[call_id] = tool
                        if name in EDIT_TOOL_NAMES:
                            src = block.get("input") or {}
                            edit = {
                                "line": line_no, "timestamp": timestamp, "call_id": call_id,
                                "name": name, "file_path": src.get("file_path"),
                                "operation": name, "patch": "", "structured_patch": None,
                                "old_string": src.get("old_string"),
                                "new_string": src.get("new_string"),
                                "content": src.get("content"),
                                "user_modified": None, "result": None,
                            }
                            code_edits.append(clean_value(edit))
                            edit_by_id[call_id] = code_edits[-1]

                # usage_frame (exclude synthetic error turns)
                if isinstance(usage, dict) and model_str != "<synthetic>":
                    last_norm = normalize_usage(usage)
                    running_total = add_usage(running_total, last_norm)
                    usage_frames.append({
                        "line": line_no, "timestamp": timestamp, "model": model_str,
                        "message_id": message_id, "last": last_norm,
                        "total": dict(running_total), "context_window": None,
                        "usage_raw": clean_value(usage),
                    })
                    latest_total_usage = dict(running_total)

        # ---- user records: human/text messages, or tool results ------------
        elif rtype == "user":
            message = record.get("message")
            if isinstance(message, dict):
                content = message.get("content")
                tool_result_blocks = [
                    b for b in content
                    if isinstance(b, dict) and b.get("type") == "tool_result"
                ] if isinstance(content, list) else []

                # splice tool results into their tool / edit
                tur = record.get("toolUseResult")
                for block in tool_result_blocks:
                    call_id = str(block.get("tool_use_id"))
                    is_error = bool(block.get("is_error"))
                    raw_result = tur if tur is not None else block.get("content")
                    result_obj = {
                        "raw": clean_value(raw_result),
                        "text": redact(result_text_from_content(block.get("content"))),
                        "kind": classify_result_kind(raw_result, is_error),
                    }
                    tool = tool_by_id.get(call_id)
                    if tool is not None:
                        tool["result"] = result_obj
                        tool["result_line"] = line_no
                        tool["is_error"] = is_error
                    edit = edit_by_id.get(call_id)
                    if edit is not None and isinstance(tur, dict):
                        sp = tur.get("structuredPatch")
                        edit["structured_patch"] = clean_value(sp)
                        edit["patch"] = build_patch_text(sp)
                        edit["user_modified"] = tur.get("userModified")
                        edit["result"] = clean_value({
                            k: tur.get(k) for k in ("filePath", "originalFile")
                            if k in tur
                        }) or None

                text_val = message_text(content).strip()
                if text_val:  # a real message (not a pure tool_result carrier)
                    role_counts["user"] += 1
                    messages.append({
                        "line": line_no, "timestamp": timestamp, "role": "user",
                        "text": redact(text_val), "uuid": record.get("uuid"),
                        "parent_uuid": record.get("parentUuid"), "model": None,
                        "stop_reason": None, "message_id": None,
                        "is_sidechain": bool(record.get("isSidechain")),
                        "is_meta": bool(record.get("isMeta")),
                        "is_compact_summary": bool(record.get("isCompactSummary")),
                        "origin_kind": (record.get("origin") or {}).get("kind"),
                        "prompt_source": record.get("promptSource"),
                        "phase": None,
                    })

        # ---- everything else becomes a context card ------------------------
        elif rtype in CONTEXT_TYPES:
            contexts.append(context_from_record(line_no, rtype, record))

        # keep the raw, cleaned record (unchanged behavior)
        cleaned = clean_value(record)
        cleaned["_line"] = line_no
        cleaned["_type"] = rtype
        records.append(cleaned)

    usage_totals["total_tokens"] = (
        usage_totals["input_tokens"]
        + usage_totals["output_tokens"]
        + usage_totals["cache_creation_input_tokens"]
        + usage_totals["cache_read_input_tokens"]
    )

    models = [m for m, _ in model_counts.most_common()]
    top_model = models[0] if models else ""
    title = ai_title or (first_prompt[:80] if first_prompt else path.stem)

    # --- subagents ----------------------------------------------------------
    subagents: list[dict[str, Any]] = []
    if include_subagents:
        subagents = parse_subagents(path, slug, tool_by_id)

    counts = {
        "user": role_counts.get("user", 0),
        "assistant": role_counts.get("assistant", 0),
        "tool_calls": len(tools),
        "tool_outputs": sum(1 for t in tools if t.get("result") is not None),
        "code_edits": len(code_edits),
        "thinking": len(thinking),
        "contexts": len(contexts),
        "usage_frames": len(usage_frames),
        "subagents": len(subagents),
    }

    audit = build_audit(
        counts, type_counts, content_block_counts, role_counts,
        system_subtype_counts, attachment_type_counts,
    )

    attribution = build_attribution(mcp_servers, mcp_tools, skills, plugins)

    return {
        "id": path.stem,
        "file": path.name,
        "slug": slug,
        "title": title,
        "first_prompt": first_prompt,
        "started_at": started_at,
        "updated_at": iso_from_mtime(mtime),
        "model": top_model,
        "models": models,
        "version": last_version or "",
        "gitBranch": last_git_branch or "",
        "cwd": last_cwd or "",
        "record_count": len(records),
        "type_counts": dict(type_counts),
        "usage_totals": usage_totals,
        "parse_errors": parse_errors,
        "records": records,
        # --- enriched shape ---
        "messages": messages,
        "thinking": thinking,
        "tools": tools,
        "code_edits": code_edits,
        "usage_frames": usage_frames,
        "contexts": contexts,
        "turn_contexts": turn_contexts,
        "subagents": subagents,
        "counts": counts,
        "audit": audit,
        "latest_total_usage": latest_total_usage or empty_usage(),
        # --- Claude-only meta (present only when found) ---
        "entrypoint": entrypoint,
        "permission_modes": permission_modes,
        "session_kind": session_kind,
        "service_tier": service_tier,
        "speed": speed,
        "bridge_session_id": bridge_session_id,
        "attribution": attribution,
        "_mtime": mtime,
    }


def build_audit(counts: dict[str, int], type_counts: Counter[str],
                content_block_counts: Counter[str], role_counts: Counter[str],
                system_subtype_counts: Counter[str],
                attachment_type_counts: Counter[str]) -> dict[str, Any]:
    visible = [
        {"name": "messages", "count": counts["user"] + counts["assistant"], "source": "assistant + text-bearing user records"},
        {"name": "thinking", "count": counts["thinking"], "source": "assistant content thinking blocks (visible plaintext + signature)"},
        {"name": "tool_calls", "count": counts["tool_calls"], "source": "assistant tool_use blocks paired to user tool_result"},
        {"name": "code_edits", "count": counts["code_edits"], "source": "Edit/Write/MultiEdit/NotebookEdit tool_use + structuredPatch"},
        {"name": "usage_frames", "count": counts["usage_frames"], "source": "assistant message.usage (normalized, running total)"},
        {"name": "contexts", "count": counts["contexts"], "source": "system/attachment/mode/permission-mode/bridge-session/file-history-snapshot/queue-operation/last-prompt/ai-title"},
        {"name": "subagents", "count": counts["subagents"], "source": "<session>/subagents/agent-*.jsonl"},
    ]
    not_available = [
        {"name": "hidden_platform_prompts", "reason": "Anthropic's private system/safety prompts are not serialized into local transcripts."},
        {"name": "server_side_routing", "reason": "Model routing / request rewriting is only visible via usage.service_tier + speed, not full detail."},
    ]
    return {
        "visible": visible,
        "not_available": not_available,
        "record_type_counts": dict(type_counts),
        "content_block_counts": dict(content_block_counts),
        "role_counts": dict(role_counts),
        "system_subtype_counts": dict(system_subtype_counts),
        "attachment_type_counts": dict(attachment_type_counts),
    }


def parse_subagents(path: Path, slug: str,
                    tool_by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Parse <session-dir>/<uuid>/subagents/agent-*.jsonl into nested enriched sessions."""
    subdir = path.parent / path.stem / "subagents"
    if not subdir.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for agent_file in sorted(subdir.glob("agent-*.jsonl")):
        meta_file = agent_file.with_suffix(".meta.json")
        meta: dict[str, Any] = {}
        if meta_file.exists():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8", errors="replace"))
            except json.JSONDecodeError:
                meta = {}
        tool_use_id = meta.get("toolUseId")
        # nested session: do NOT recurse into further subagents (bound the cost)
        nested = enrich_session(agent_file, slug, include_subagents=False)
        nested.pop("_mtime", None)
        parent_tool = tool_by_id.get(str(tool_use_id)) if tool_use_id else None
        agent_id = agent_file.stem  # agent-XXXX
        entry = {
            "agent_id": agent_id,
            "agent_type": meta.get("agentType"),
            "description": meta.get("description"),
            "tool_use_id": tool_use_id,
            "spawn_depth": meta.get("spawnDepth"),
            "parent_line": parent_tool.get("line") if parent_tool else None,
            "session": nested,
            "usage_totals": nested.get("latest_total_usage") or empty_usage(),
        }
        if parent_tool is not None:
            parent_tool["subagent_id"] = agent_id
        out.append(entry)
    return out


def parse_session(path: Path, slug: str) -> dict[str, Any]:
    return enrich_session(path, slug, include_subagents=True)


# --- auto-title-label sessions -------------------------------------------------
# Claude Code fires a tiny background SDK call ("Output ONLY a terminal tab
# label ...") to name each conversation's terminal tab. Every call is written as
# its own session .jsonl, so a single conversation spawns several near-identical
# label sessions that are not real work. Fold them into their parent session so
# the list shows one row per conversation.
TITLE_OP_PROMPT = "output only a terminal tab label"


def is_title_op(sess: dict[str, Any]) -> bool:
    if (sess.get("entrypoint") or "") != "sdk-cli":
        return False
    return (sess.get("first_prompt") or "").strip().lower().startswith(TITLE_OP_PROMPT)


def _epoch(iso: str | None) -> float:
    if not iso:
        return 0.0
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def attach_title_ops(sessions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Split terminal-tab-label ops out of the top-level list and nest the full op
    session (records included, so the UI can show what each one is) under its parent
    real session. Returns the real-session list (unchanged if there are no ops).
    Parent = same cwd + gitBranch, preferring an identical generated title, breaking
    ties by nearest start time."""
    ops = [s for s in sessions if is_title_op(s)]
    normals = [s for s in sessions if not is_title_op(s)]
    for s in normals:
        s.setdefault("title_ops", [])
    if not ops:
        return sessions

    def find_parent(op: dict[str, Any]) -> dict[str, Any] | None:
        cwd = op.get("cwd") or ""
        branch = op.get("gitBranch") or ""
        title = (op.get("title") or "").strip().lower()
        cands = [s for s in normals
                 if (s.get("cwd") or "") == cwd and (s.get("gitBranch") or "") == branch] or normals
        titled = [s for s in cands if (s.get("title") or "").strip().lower() == title]
        pool = titled or cands
        if not pool:
            return None
        ts = _epoch(op.get("started_at"))
        return min(pool, key=lambda s: abs(_epoch(s.get("started_at")) - ts))

    for op in ops:
        op["session_kind"] = "title-op"
        parent = find_parent(op)
        if parent is None:
            normals.append(op)  # nothing to attach to — keep it visible
            continue
        op["parent_session_id"] = parent.get("id")
        parent["title_ops"].append(op)
    for s in normals:
        if s.get("title_ops"):
            s["title_ops"].sort(key=lambda o: _epoch(o.get("started_at")), reverse=True)
    return normals


def build_projects(files: list[Path], project_substr: str | None) -> list[dict[str, Any]]:
    by_slug: dict[str, list[Path]] = {}
    for path in files:
        slug = path.parent.name
        if project_substr and project_substr.lower() not in slug.lower():
            continue
        by_slug.setdefault(slug, []).append(path)

    projects: list[dict[str, Any]] = []
    for slug, paths in by_slug.items():
        paths.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        sessions = [parse_session(path, slug) for path in paths]
        # Decode a human cwd from any session that recorded one; else the slug.
        decoded_cwd = slug
        for sess in sessions:
            if sess.get("cwd"):
                decoded_cwd = sess["cwd"]
                break
        newest_mtime = max((s["_mtime"] for s in sessions), default=0.0)
        for sess in sessions:
            sess.pop("_mtime", None)
        # Fold auto-generated terminal-tab-label sessions into their parent.
        top_sessions = attach_title_ops(sessions)
        projects.append({
            "slug": slug,
            "cwd": decoded_cwd,
            "session_count": len(top_sessions),
            "sessions": top_sessions,
            "_newest_mtime": newest_mtime,
        })

    # Projects newest-first; but any slug containing "karin" jumps to the front.
    projects.sort(key=lambda p: p["_newest_mtime"], reverse=True)
    projects.sort(key=lambda p: 0 if "karin" in p["slug"].lower() else 1)
    for proj in projects:
        proj.pop("_newest_mtime", None)
    return projects


def build_status(files: list[Path]) -> dict[str, Any]:
    latest_mtime = max((path.stat().st_mtime for path in files), default=0.0)
    return {
        "last_checked_at": datetime.now(timezone.utc).isoformat(),
        "last_entry_at": iso_from_mtime(latest_mtime),
        "session_file_count": len(files),
    }


def build_payload(limit: int | None, project_substr: str | None) -> dict[str, Any]:
    all_files = iter_session_files()
    if project_substr:
        all_files = [f for f in all_files if project_substr.lower() in f.parent.name.lower()]
    status = build_status(all_files)
    files = all_files if not limit else all_files[:limit]
    projects = build_projects(files, project_substr)
    session_count = sum(p["session_count"] for p in projects)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "claude_home": str(CLAUDE_HOME),
        "project_count": len(projects),
        "session_count": session_count,
        **status,
        "projects": projects,
    }


def status_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "last_checked_at": payload.get("last_checked_at"),
        "last_entry_at": payload.get("last_entry_at"),
        "session_file_count": payload.get("session_file_count"),
    }


def write_data(payload: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False)
    DATA_JSON.write_text(text, encoding="utf-8")
    DATA_STATUS.write_text(json.dumps(status_from_payload(payload), ensure_ascii=False), encoding="utf-8")
    if DIST_DATA_DIR.exists():
        DIST_DATA_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(DATA_JSON, DIST_DATA_DIR / DATA_JSON.name)
        shutil.copy2(DATA_STATUS, DIST_DATA_DIR / DATA_STATUS.name)


def write_status(status: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATA_STATUS.write_text(json.dumps(status, ensure_ascii=False), encoding="utf-8")
    if DIST_DATA_DIR.exists():
        DIST_DATA_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(DATA_STATUS, DIST_DATA_DIR / DATA_STATUS.name)


def latest_session_mtime(project_substr: str | None) -> float:
    files = iter_session_files()
    if project_substr:
        files = [f for f in files if project_substr.lower() in f.parent.name.lower()]
    if not files:
        return 0.0
    return max(path.stat().st_mtime for path in files)


def index_once(limit: int | None, project_substr: str | None) -> dict[str, Any]:
    payload = build_payload(limit, project_substr)
    write_data(payload)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Index local Claude Code sessions for the Karin web app.")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT,
                        help=f"Index only the newest N session files globally by mtime (default {DEFAULT_LIMIT}).")
    parser.add_argument("--all", action="store_true", help="Index every session file (overrides --limit).")
    parser.add_argument("--project", type=str, default=None, help="Only projects whose slug contains this substring.")
    parser.add_argument("--watch", action="store_true", help="Keep indexing when Claude session files change.")
    parser.add_argument("--interval", type=float, default=5.0, help="Watch polling interval in seconds.")
    args = parser.parse_args()

    limit = None if args.all else args.limit

    payload = index_once(limit, args.project)
    print(f"Karin (Claude) indexed {payload['session_count']} sessions across {payload['project_count']} projects")
    print(f"JSON:   {DATA_JSON}")
    print(f"STATUS: {DATA_STATUS}")

    if args.watch:
        last_mtime = latest_session_mtime(args.project)
        try:
            while True:
                time.sleep(max(args.interval, 1.0))
                files = iter_session_files()
                if args.project:
                    files = [f for f in files if args.project.lower() in f.parent.name.lower()]
                status = build_status(files)
                write_status(status)
                current_mtime = max((path.stat().st_mtime for path in files), default=0.0)
                if current_mtime <= last_mtime:
                    continue
                payload = index_once(limit, args.project)
                last_mtime = current_mtime
                print(f"Karin (Claude) indexed {payload['session_count']} sessions at {payload['generated_at']}", flush=True)
        except KeyboardInterrupt:
            return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
