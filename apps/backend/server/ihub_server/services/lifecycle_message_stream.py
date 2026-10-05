"""Application-scoped fan-out for lifecycle message refresh notifications."""

import asyncio
import logging
from collections import deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

_log = logging.getLogger("ihub-server")


class _ShutdownSentinel:
    """Signal subscribers that the application stream is shutting down."""


SHUTDOWN = _ShutdownSentinel()
type LifecycleStreamItem = str | _ShutdownSentinel


class LifecycleMessageStreamManager:
    """Replay and broadcast lifecycle envelopes across runtime broker clients."""

    def __init__(self, history_size: int = 20) -> None:
        """Initialize an inactive manager with bounded process-local history."""
        self._history: deque[str] = deque(maxlen=history_size)
        self._subscribers: set[asyncio.Queue[LifecycleStreamItem]] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._shutting_down = False

    async def start(self) -> None:
        """Capture the running application loop before broker clients connect."""
        self._loop = asyncio.get_running_loop()
        self._shutting_down = False

    def publish(self, message: str) -> None:
        """Schedule a lifecycle envelope from any SDK callback thread."""
        loop = self._loop
        if loop is None or self._shutting_down:
            _log.debug("Ignoring lifecycle publication while stream manager is inactive.")
            return
        try:
            loop.call_soon_threadsafe(self._publish_on_event_loop, message)
        except RuntimeError:
            _log.debug("Ignoring lifecycle publication after the event loop closed.")

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[LifecycleStreamItem]]:
        """Register a lossless subscriber and replay retained messages in order."""
        queue: asyncio.Queue[LifecycleStreamItem] = asyncio.Queue()
        if self._shutting_down:
            queue.put_nowait(SHUTDOWN)
        else:
            for message in self._history:
                queue.put_nowait(message)
            self._subscribers.add(queue)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)

    async def shutdown(self) -> None:
        """Stop accepting publications and release every active subscriber."""
        self._shutting_down = True
        self._loop = None
        for queue in self._subscribers:
            queue.put_nowait(SHUTDOWN)
        self._subscribers.clear()

    @property
    def subscriber_count(self) -> int:
        """Return the number of currently registered browser subscribers."""
        return len(self._subscribers)

    def _publish_on_event_loop(self, message: str) -> None:
        """Record and fan out one message on the captured event loop."""
        if self._shutting_down:
            return
        self._history.append(message)
        for queue in self._subscribers:
            queue.put_nowait(message)
