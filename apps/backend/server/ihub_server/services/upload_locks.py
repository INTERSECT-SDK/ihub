"""Application-lifetime serialization for project file uploads."""

import asyncio
from collections.abc import AsyncIterator, Iterable
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, field
from urllib.parse import unquote, urlsplit, urlunsplit


@dataclass
class _UploadLockEntry:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    references: int = 0


class UploadLockManager:
    """Serialize uploads to the same Jupyter contents target within one process."""

    def __init__(self) -> None:
        self._registry_lock = asyncio.Lock()
        self._entries: dict[tuple[str, str, str], _UploadLockEntry] = {}

    @asynccontextmanager
    async def lock(
        self,
        base_url: str,
        jupyter_user: str,
        contents_path: str,
    ) -> AsyncIterator[None]:
        """Acquire the lock for one normalized server, user, and contents path."""
        key = (
            self._normalize_base_url(base_url, jupyter_user),
            jupyter_user.casefold(),
            contents_path,
        )
        async with self._registry_lock:
            entry = self._entries.get(key)
            if entry is None:
                entry = _UploadLockEntry()
                self._entries[key] = entry
            entry.references += 1

        try:
            async with entry.lock:
                yield
        finally:
            async with self._registry_lock:
                entry.references -= 1
                if entry.references == 0:
                    self._entries.pop(key, None)

    @asynccontextmanager
    async def lock_many(
        self,
        base_url: str,
        jupyter_user: str,
        contents_paths: Iterable[str],
    ) -> AsyncIterator[None]:
        """Acquire existing target locks once each in deterministic path order."""
        async with AsyncExitStack() as stack:
            for contents_path in sorted(set(contents_paths)):
                await stack.enter_async_context(self.lock(base_url, jupyter_user, contents_path))
            yield

    @property
    def active_lock_count(self) -> int:
        """Return the number of target entries retained by active callers."""
        return len(self._entries)

    @staticmethod
    def _normalize_base_url(base_url: str, jupyter_user: str) -> str:
        split_url = urlsplit(base_url.strip())
        normalized_path = split_url.path.rstrip("/")
        user_server_parent, separator, encoded_user = normalized_path.rpartition("/")
        if (
            separator
            and user_server_parent.endswith("/user")
            and unquote(encoded_user) == jupyter_user
        ):
            normalized_path = user_server_parent.removesuffix("/user")

        return urlunsplit(
            (
                split_url.scheme.casefold(),
                split_url.netloc.casefold(),
                normalized_path,
                "",
                "",
            )
        )
