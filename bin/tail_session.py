"""Prototype: how fast can we possibly know a Claude .jsonl grew?

Two detection strategies, same output, so they can be compared on one machine:

  event  ReadDirectoryChangesW — the OS wakes us; no polling, no idle cost.
  poll   stat() the single file every --interval seconds.

Neither re-indexes anything. This measures the detection floor only: the gap
between a line hitting the transcript and this process knowing about it.

    python bin/tail_session.py --session <uuid>     # follow one session
    python bin/tail_session.py --selftest           # measure latency, no guessing
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import sys
import tempfile
import threading
import time
from ctypes import wintypes
from pathlib import Path

CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", Path.home() / ".claude"))
PROJECTS_DIR = CLAUDE_HOME / "projects"

# --- Win32 -------------------------------------------------------------------
FILE_LIST_DIRECTORY = 0x0001
FILE_SHARE_ALL = 0x0007  # read | write | delete — never block the writer
OPEN_EXISTING = 3
FILE_FLAG_BACKUP_SEMANTICS = 0x02000000  # required to open a directory handle
FILE_NOTIFY_CHANGE_FILE_NAME = 0x0001
FILE_NOTIFY_CHANGE_SIZE = 0x0008
FILE_NOTIFY_CHANGE_LAST_WRITE = 0x0010
WATCH_FLAGS = FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_SIZE | FILE_NOTIFY_CHANGE_LAST_WRITE
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.CreateFileW.restype = wintypes.HANDLE
kernel32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                 wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
kernel32.ReadDirectoryChangesW.restype = wintypes.BOOL
kernel32.ReadDirectoryChangesW.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
                                           wintypes.BOOL, wintypes.DWORD, wintypes.LPDWORD,
                                           wintypes.LPVOID, wintypes.LPVOID]


def open_dir(path: Path) -> wintypes.HANDLE:
    handle = kernel32.CreateFileW(str(path), FILE_LIST_DIRECTORY, FILE_SHARE_ALL, None,
                                  OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, None)
    if handle == INVALID_HANDLE_VALUE:
        raise ctypes.WinError(ctypes.get_last_error())
    return handle


def changed_names(handle: wintypes.HANDLE, buf: ctypes.Array, subtree: bool = False) -> list[str]:
    """Block until the directory changes; return the file names reported.

    With subtree=True the names are relative paths below the watched directory.
    """
    returned = wintypes.DWORD(0)
    ok = kernel32.ReadDirectoryChangesW(handle, buf, len(buf), subtree, WATCH_FLAGS,
                                        ctypes.byref(returned), None, None)
    if not ok:
        raise ctypes.WinError(ctypes.get_last_error())
    names: list[str] = []
    offset = 0
    while True:
        next_off, _action, name_len = ctypes.cast(
            ctypes.byref(buf, offset), ctypes.POINTER(wintypes.DWORD * 3)).contents[:]
        name = ctypes.wstring_at(ctypes.byref(buf, offset + 12), name_len // 2)
        names.append(name)
        if not next_off:
            return names
        offset += next_off


# --- following ---------------------------------------------------------------
def describe(line: str) -> str:
    """One-line summary of an appended transcript record."""
    try:
        rec = json.loads(line)
    except json.JSONDecodeError:
        return f"(unparsed {len(line)}B)"
    kind = rec.get("type") or "?"
    msg = rec.get("message") or {}
    content = msg.get("content")
    if isinstance(content, list):
        parts = [c.get("name") or (c.get("text") or "")[:60] for c in content if isinstance(c, dict)]
        text = " | ".join(p for p in parts if p)
    else:
        text = str(content or "")[:60]
    return f"{kind:9} {text[:70]}"


class Follower:
    """Reads only the bytes appended since last time."""

    def __init__(self, path: Path):
        self.path = path
        self.offset = path.stat().st_size if path.exists() else 0

    def drain(self) -> list[str]:
        if not self.path.exists():
            return []
        size = self.path.stat().st_size
        if size <= self.offset:
            self.offset = min(self.offset, size)  # truncated/rotated
            return []
        with self.path.open("rb") as fh:
            fh.seek(self.offset)
            chunk = fh.read(size - self.offset)
        self.offset = size
        return [ln for ln in chunk.decode("utf-8", "replace").splitlines() if ln.strip()]


def follow_event(path: Path, on_lines) -> None:
    handle = open_dir(path.parent)
    buf = ctypes.create_string_buffer(64 * 1024)
    follower = Follower(path)
    while True:
        names = changed_names(handle, buf)
        if path.name not in names:
            continue
        lines = follower.drain()
        if lines:
            on_lines(lines)


def follow_poll(path: Path, on_lines, interval: float) -> None:
    follower = Follower(path)
    last = (0.0, -1)
    while True:
        try:
            st = path.stat()
            sig = (st.st_mtime, st.st_size)
        except FileNotFoundError:
            sig = (0.0, -1)
        if sig != last:
            last = sig
            lines = follower.drain()
            if lines:
                on_lines(lines)
        time.sleep(interval)


# --- selftest ----------------------------------------------------------------
def selftest(mode: str, interval: float, rounds: int) -> int:
    """Write timestamped lines to a temp file and measure detection latency."""
    tmp = Path(tempfile.mkdtemp(prefix="karin-probe-"))
    target = tmp / "probe.jsonl"
    target.write_text("", encoding="utf-8")
    lats: list[float] = []
    done = threading.Event()

    def on_lines(lines: list[str]) -> None:
        now = time.perf_counter()
        for ln in lines:
            try:
                sent = json.loads(ln)["sent_at"]
            except Exception:
                continue
            lats.append((now - sent) * 1000)
            print(f"  probe {len(lats)}: {lats[-1]:7.1f} ms")
        if len(lats) >= rounds:
            done.set()

    runner = (lambda: follow_event(target, on_lines)) if mode == "event" \
        else (lambda: follow_poll(target, on_lines, interval))
    threading.Thread(target=runner, daemon=True).start()
    time.sleep(0.5)  # let the watch arm

    for _ in range(rounds):
        with target.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"sent_at": time.perf_counter()}) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        time.sleep(0.4)

    done.wait(timeout=10)
    if not lats:
        print("no detections — FAILED")
        return 1
    label = mode if mode == "event" else f"poll {interval * 1000:.0f}ms"
    print(f"\n{label:12} n={len(lats)}  min {min(lats):.1f} ms  "
          f"avg {sum(lats) / len(lats):.1f} ms  max {max(lats):.1f} ms")
    return 0


def find_session(session: str) -> Path:
    matches = sorted(PROJECTS_DIR.rglob(f"*{session}*.jsonl"))
    if not matches:
        sys.exit(f"no transcript matching {session!r} under {PROJECTS_DIR}")
    return matches[0]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--session", help="Session id (or any substring of the .jsonl name).")
    ap.add_argument("--mode", choices=("event", "poll"), default="event")
    ap.add_argument("--interval", type=float, default=0.02, help="Poll mode only (seconds).")
    ap.add_argument("--selftest", action="store_true", help="Measure latency against a temp file.")
    ap.add_argument("--rounds", type=int, default=5)
    args = ap.parse_args()

    if args.selftest:
        return selftest(args.mode, args.interval, args.rounds)
    if not args.session:
        ap.error("--session is required (or use --selftest)")

    path = find_session(args.session)
    started = time.time()
    print(f"watching [{args.mode}] {path}", flush=True)

    def on_lines(lines: list[str]) -> None:
        stamp = time.time() - started
        for ln in lines:
            print(f"+{stamp:7.3f}s  {describe(ln)}", flush=True)

    try:
        if args.mode == "event":
            follow_event(path, on_lines)
        else:
            follow_poll(path, on_lines, args.interval)
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
