"""Shared Windows directory-change wakeup for the Codex and Claude indexers."""

from __future__ import annotations

import ctypes
import os
import threading
from ctypes import wintypes
from pathlib import Path


FILE_LIST_DIRECTORY = 0x0001
FILE_SHARE_ALL = 0x0007
OPEN_EXISTING = 3
FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
FILE_NOTIFY_CHANGE_FILE_NAME = 0x0001
FILE_NOTIFY_CHANGE_SIZE = 0x0008
FILE_NOTIFY_CHANGE_LAST_WRITE = 0x0010
WATCH_FLAGS = FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_SIZE | FILE_NOTIFY_CHANGE_LAST_WRITE
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value


def start_change_signal(root: Path, suffixes: tuple[str, ...] = ('.jsonl',)) -> threading.Event | None:
    """Return an event set by matching file changes below *root*, or None if unavailable."""
    if os.name != 'nt' or not root.exists():
        return None
    try:
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel32.CreateFileW.restype = wintypes.HANDLE
        kernel32.CreateFileW.argtypes = [wintypes.LPCWSTR, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, wintypes.HANDLE]
        kernel32.ReadDirectoryChangesW.restype = wintypes.BOOL
        kernel32.ReadDirectoryChangesW.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_uint32, wintypes.BOOL, ctypes.c_uint32, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p, ctypes.c_void_p]
        handle = kernel32.CreateFileW(str(root), FILE_LIST_DIRECTORY, FILE_SHARE_ALL, None, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, None)
        if handle == INVALID_HANDLE_VALUE:
            return None
    except Exception:
        return None

    signal = threading.Event()

    def pump() -> None:
        buf = ctypes.create_string_buffer(64 * 1024)
        while True:
            try:
                returned = wintypes.DWORD(0)
                ok = kernel32.ReadDirectoryChangesW(handle, buf, len(buf), True, WATCH_FLAGS, ctypes.byref(returned), None, None)
                if not ok:
                    return
                offset = 0
                matched = False
                while True:
                    next_offset, _action, name_length = ctypes.cast(ctypes.byref(buf, offset), ctypes.POINTER(wintypes.DWORD * 3)).contents[:]
                    name = ctypes.wstring_at(ctypes.byref(buf, offset + 12), name_length // 2)
                    matched = matched or name.endswith(suffixes)
                    if not next_offset:
                        break
                    offset += next_offset
                if matched:
                    signal.set()
            except (OSError, ValueError):
                return

    threading.Thread(target=pump, daemon=True).start()
    return signal
