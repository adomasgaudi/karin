"""Small cross-platform lock for Karin's one-writer-per-source rule."""

from __future__ import annotations

import os
from pathlib import Path
from typing import TextIO


class WatchLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._handle: TextIO | None = None

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+", encoding="utf-8")
        # msvcrt.locking locks bytes, so ensure the file has one byte to lock.
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write("0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (ImportError, OSError):
            handle.close()
            return False
        self._handle = handle
        return True

    def release(self) -> None:
        handle = self._handle
        if handle is None:
            return
        try:
            if os.name == "nt":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()
            self._handle = None


def acquire_watch_lock(path: Path) -> WatchLock | None:
    lock = WatchLock(path)
    return lock if lock.acquire() else None
