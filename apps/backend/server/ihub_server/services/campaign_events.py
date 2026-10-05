"""Application-lifetime consumption of broker-scoped campaign events."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import websockets
from fastapi import WebSocket
from sqlmodel import Session

from ihub_server.models.campaign_run import (
    CampaignRun,
    CampaignRunOutcome,
    CampaignRunStatus,
)
from ihub_server.models.orchestrator_event import OrchestratorEventCreate
from ihub_server.services.brokers import BrokerService
from ihub_server.services.campaign_runs import CampaignRunService
from ihub_server.services.errors import NotFoundError, ServiceError
from ihub_server.services.orchestrator_events import OrchestratorEventService

_log = logging.getLogger("ihub-server")

_TERMINAL_CAMPAIGN_TRANSITIONS = {
    "CAMPAIGN_COMPLETE": (CampaignRunStatus.COMPLETED, CampaignRunOutcome.SUCCEEDED),
    "CAMPAIGN_END": (CampaignRunStatus.COMPLETED, CampaignRunOutcome.SUCCEEDED),
    "CAMPAIGN_SUCCESS": (CampaignRunStatus.COMPLETED, CampaignRunOutcome.SUCCEEDED),
    "CAMPAIGN_ERROR_FROM_SERVICE": (CampaignRunStatus.ABORTED, CampaignRunOutcome.FAILED),
    "CAMPAIGN_ERROR_SCHEMA": (CampaignRunStatus.ABORTED, CampaignRunOutcome.FAILED),
    "UNKNOWN_ERROR": (CampaignRunStatus.ABORTED, CampaignRunOutcome.FAILED),
}
_DEFAULT_RECONNECT_DELAYS = (0.25, 0.5, 1.0, 2.0, 5.0)


@dataclass(frozen=True)
class _ListenerStopped:
    error: ServiceError | None = None


type _SubscriberMessage = str | _ListenerStopped


@dataclass
class _BrokerListener:
    broker_id: int
    connected: asyncio.Event = field(default_factory=asyncio.Event)
    subscribers: set[asyncio.Queue[_SubscriberMessage]] = field(default_factory=set)
    start_holds: int = 0
    task: asyncio.Task[None] | None = None
    failure: ServiceError | None = None


class CampaignEventManager:
    """Own upstream campaign listeners independently of browser connections."""

    def __init__(
        self,
        session_factory: Callable[[], Session],
        *,
        reconnect_delays: tuple[float, ...] = _DEFAULT_RECONNECT_DELAYS,
    ) -> None:
        """Initialize the manager with a factory for short-lived database sessions."""
        self._session_factory = session_factory
        self._reconnect_delays = reconnect_delays or (0.0,)
        self._listeners: dict[int, _BrokerListener] = {}
        self._lock = asyncio.Lock()
        self._shutting_down = False

    async def start(self) -> None:
        """Restore background listeners for brokers with active persisted runs."""
        with self._session_factory() as session:
            broker_ids = CampaignRunService(session).list_active_broker_ids()
        for broker_id in broker_ids:
            await self._get_or_create_listener(broker_id)

    async def shutdown(self) -> None:
        """Cancel all broker listeners and wait for their cleanup."""
        async with self._lock:
            self._shutting_down = True
            tasks = [
                listener.task for listener in self._listeners.values() if listener.task is not None
            ]
            for task in tasks:
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    @asynccontextmanager
    async def hold_listener_for_start(self, broker_id: int) -> AsyncIterator[None]:
        """Keep a connected listener in place while a campaign start is submitted."""
        listener = await self._get_or_create_listener(broker_id, hold_start=True)
        try:
            await self._wait_until_connected(listener)
            yield
        finally:
            async with self._lock:
                listener.start_holds = max(0, listener.start_holds - 1)
            await self._stop_if_idle(listener)

    @asynccontextmanager
    async def subscribe(
        self,
        broker_id: int,
    ) -> AsyncIterator[asyncio.Queue[_SubscriberMessage]]:
        """Subscribe one browser queue to a broker's shared upstream listener."""
        queue: asyncio.Queue[_SubscriberMessage] = asyncio.Queue()
        listener = await self._get_or_create_listener(broker_id, subscriber=queue)
        try:
            await self._wait_until_connected(listener)
            yield queue
        finally:
            async with self._lock:
                listener.subscribers.discard(queue)
            await self._stop_if_idle(listener)

    async def relay_events(self, broker_id: int, websocket: WebSocket) -> None:
        """Forward shared broker events until this browser subscription disconnects."""
        async with self.subscribe(broker_id) as queue:
            await websocket.send_text(self._build_relay_ready_message(broker_id))
            while True:
                event_task = asyncio.create_task(queue.get())
                disconnect_task = asyncio.create_task(websocket.receive())
                done, pending = await asyncio.wait(
                    {event_task, disconnect_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for task in pending:
                    task.cancel()
                if pending:
                    await asyncio.gather(*pending, return_exceptions=True)

                if disconnect_task in done:
                    message = disconnect_task.result()
                    if message["type"] == "websocket.disconnect":
                        return
                    continue

                subscriber_message = event_task.result()
                if isinstance(subscriber_message, _ListenerStopped):
                    if subscriber_message.error is not None:
                        raise subscriber_message.error
                    return
                await websocket.send_text(subscriber_message)

    def has_listener(self, broker_id: int) -> bool:
        """Return whether this process currently owns a broker listener."""
        return broker_id in self._listeners

    def subscriber_count(self, broker_id: int) -> int:
        """Return the current number of browser subscribers for a broker."""
        listener = self._listeners.get(broker_id)
        return len(listener.subscribers) if listener is not None else 0

    async def _get_or_create_listener(
        self,
        broker_id: int,
        *,
        subscriber: asyncio.Queue[_SubscriberMessage] | None = None,
        hold_start: bool = False,
    ) -> _BrokerListener:
        """Return the shared listener for a broker, creating it when needed."""
        async with self._lock:
            if self._shutting_down:
                msg = "Campaign event manager is shutting down."
                raise ServiceError(msg)

            listener = self._listeners.get(broker_id)
            if listener is None or listener.task is None or listener.task.done():
                listener = _BrokerListener(broker_id=broker_id)
                self._listeners[broker_id] = listener
                listener.task = asyncio.create_task(
                    self._listen(listener),
                    name=f"campaign-events-{broker_id}",
                )
            if subscriber is not None:
                listener.subscribers.add(subscriber)
            if hold_start:
                listener.start_holds += 1
            return listener

    async def _wait_until_connected(self, listener: _BrokerListener) -> None:
        """Block until a listener connects or raise the listener startup failure."""
        while not listener.connected.is_set():
            if listener.task is None:
                break
            connected_task = asyncio.create_task(listener.connected.wait())
            done, pending = await asyncio.wait(
                {connected_task, listener.task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                if task is not listener.task:
                    task.cancel()
            if connected_task in done and connected_task.result():
                return
            if listener.task in done:
                break

        if listener.connected.is_set():
            return
        if listener.failure is not None:
            raise listener.failure
        msg = f"Campaign event listener stopped before connecting for broker {listener.broker_id}."
        raise ServiceError(msg)

    async def _listen(self, listener: _BrokerListener) -> None:
        """Consume one broker's upstream event stream and fan out decoded messages."""
        reconnect_attempt = 0
        try:
            while not self._shutting_down:
                try:
                    upstream_url, headers = self._load_upstream_connection(listener.broker_id)
                    async with websockets.connect(
                        upstream_url,
                        additional_headers=headers,
                    ) as upstream_websocket:
                        listener.failure = None
                        listener.connected.set()
                        reconnect_attempt = 0
                        _log.info(
                            "Consuming campaign events for broker %s via %s",
                            listener.broker_id,
                            upstream_url,
                        )
                        while True:
                            message = await upstream_websocket.recv()
                            relay_message = self._normalize_message(message)
                            payload = self._decode_orchestrator_event(message)
                            if payload is not None:
                                try:
                                    enriched_payload = self._ingest_orchestrator_event(
                                        listener.broker_id,
                                        payload,
                                    )
                                    if enriched_payload is not None:
                                        relay_message = json.dumps(enriched_payload)
                                except Exception:  # noqa: BLE001 - isolate each frame
                                    _log.exception(
                                        "Failed to ingest campaign event for broker %s; continuing listener",
                                        listener.broker_id,
                                    )
                            await self._broadcast(listener, relay_message)
                            if not await self._should_keep_running(listener):
                                return
                except asyncio.CancelledError:
                    raise
                except NotFoundError as err:
                    # Missing broker/config is permanent; retrying will never succeed.
                    listener.connected.clear()
                    listener.failure = self._listener_error(listener.broker_id, err)
                    self._abort_active_runs(listener.broker_id)
                    return
                except (OSError, websockets.WebSocketException) as err:
                    listener.connected.clear()
                    listener.failure = self._listener_error(listener.broker_id, err)
                    if not self._has_active_runs(listener.broker_id):
                        return
                    delay = self._reconnect_delays[
                        min(reconnect_attempt, len(self._reconnect_delays) - 1)
                    ]
                    reconnect_attempt += 1
                    _log.warning(
                        "Campaign event listener for broker %s disconnected; retrying in %.2fs",
                        listener.broker_id,
                        delay,
                    )
                    await asyncio.sleep(delay)
        finally:
            listener.connected.clear()
            async with self._lock:
                if self._listeners.get(listener.broker_id) is listener:
                    self._listeners.pop(listener.broker_id, None)
            await self._broadcast(listener, _ListenerStopped(listener.failure))

    async def _should_keep_running(self, listener: _BrokerListener) -> bool:
        """Return whether listener demand or active campaign runs still exist."""
        async with self._lock:
            if self._shutting_down:
                return False
            if listener.subscribers or listener.start_holds:
                return True
        return self._has_active_runs(listener.broker_id)

    async def _stop_if_idle(self, listener: _BrokerListener) -> None:
        """Cancel a listener once it has no subscribers, start hold, or active run."""
        if self._has_active_runs(listener.broker_id):
            return
        async with self._lock:
            if listener.subscribers or listener.start_holds:
                return
            if self._listeners.get(listener.broker_id) is not listener:
                return
            if listener.task is not None and not listener.task.done():
                listener.task.cancel()

    async def _broadcast(
        self,
        listener: _BrokerListener,
        message: _SubscriberMessage,
    ) -> None:
        """Publish a message to every current subscriber queue for a listener."""
        async with self._lock:
            subscribers = tuple(listener.subscribers)
        for queue in subscribers:
            queue.put_nowait(message)

    def _load_upstream_connection(self, broker_id: int) -> tuple[str, dict[str, str]]:
        """Load the broker's websocket URL and authorization headers."""
        with self._session_factory() as session:
            broker = BrokerService(session).get_broker(broker_id)
            orchestrator_url = broker.orchestrator_url
            orchestrator_api_key = broker.orchestrator_api_key
        if not orchestrator_url:
            msg = "Missing orchestrator URL."
            raise NotFoundError(msg)
        if not orchestrator_api_key:
            msg = "Missing orchestrator API key."
            raise NotFoundError(msg)
        return self._build_orchestrator_events_url(orchestrator_url), {
            "Authorization": orchestrator_api_key
        }

    def _has_active_runs(self, broker_id: int) -> bool:
        """Return whether a broker has persisted campaign runs still in progress."""
        with self._session_factory() as session:
            return CampaignRunService(session).has_active_runs_for_broker(broker_id)

    def _abort_active_runs(self, broker_id: int) -> None:
        """Abort persisted runs left behind by a broker that no longer exists."""
        with self._session_factory() as session:
            CampaignRunService(session).abort_active_runs_for_broker(broker_id)

    def _ingest_orchestrator_event(
        self,
        broker_id: int,
        payload: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Correlate, enrich, and atomically persist one broker event."""
        with self._session_factory() as session:
            run_service = CampaignRunService(session)
            run = self._correlate_run(run_service, broker_id, payload)
            if run is None:
                return None

            supplied_campaign_id = payload.get("campaign_id")
            if (
                isinstance(supplied_campaign_id, str)
                and supplied_campaign_id
                and supplied_campaign_id != run.campaign_id
            ):
                _log.warning(
                    "Rejecting campaign event for broker %s run %s with conflicting campaign %s",
                    broker_id,
                    run.run_id,
                    supplied_campaign_id,
                )
                return None

            canonical_payload = {
                key: value for key, value in payload.items() if key != "ihub_event_id"
            }
            enriched_payload = {
                **canonical_payload,
                "campaign_id": run.campaign_id,
                "run_id": run.run_id,
            }

            event_type = self._get_orchestrator_event_type(enriched_payload)
            terminal_transition = _TERMINAL_CAMPAIGN_TRANSITIONS.get(event_type or "")
            terminal_status = terminal_transition[0] if terminal_transition else None
            terminal_outcome = terminal_transition[1] if terminal_transition else None
            persisted_event = OrchestratorEventService(session).record_correlated_event(
                self._build_orchestrator_event(
                    enriched_payload,
                    run.campaign_id,
                    run.run_id,
                ),
                run,
                terminal_status,
                terminal_outcome,
            )
            return {
                **enriched_payload,
                "ihub_event_id": persisted_event.id,
            }

    def _correlate_run(
        self,
        run_service: CampaignRunService,
        broker_id: int,
        payload: dict[str, Any],
    ) -> CampaignRun | None:
        """Match an orchestrator payload to exactly one campaign run when possible."""
        payload_run_id = payload.get("run_id")
        if isinstance(payload_run_id, str) and payload_run_id:
            run = run_service.get_run_by_run_id_and_broker(payload_run_id, broker_id)
            if run is None:
                _log.warning(
                    "No campaign run matched event for broker %s run %s",
                    broker_id,
                    payload_run_id,
                )
            return run

        campaign_id = payload.get("campaign_id")
        if isinstance(campaign_id, str) and campaign_id:
            candidates = run_service.list_active_runs_by_campaign_and_broker(
                campaign_id,
                broker_id,
                limit=2,
            )
        else:
            candidates = run_service.list_active_runs_by_broker(
                broker_id,
                limit=2,
            )
        if len(candidates) != 1:
            _log.warning(
                "Skipping ambiguous event for broker %s campaign %s; found %s active runs",
                broker_id,
                campaign_id,
                len(candidates),
            )
            return None
        return candidates[0]

    def _build_orchestrator_event(
        self,
        payload: dict[str, Any],
        campaign_id: str,
        run_id: str,
    ) -> OrchestratorEventCreate:
        """Translate an orchestrator payload into a persisted event create model."""
        event_payload = payload.get("event")
        source = event_payload if isinstance(event_payload, dict) else payload
        step_id = source.get("step_id")
        event_type = source.get("event_type")
        fields_to_populate = source.get("fields_to_populate")
        exception_message = source.get("exception_message")
        return OrchestratorEventCreate(
            campaign_id=campaign_id,
            run_id=run_id,
            step_id=step_id if isinstance(step_id, str) and step_id else None,
            event_type=event_type if isinstance(event_type, str) else None,
            fields_to_populate=(
                fields_to_populate if isinstance(fields_to_populate, list) else None
            ),
            exception_message=(exception_message if isinstance(exception_message, str) else None),
            payload=payload,
        )

    @staticmethod
    def _build_orchestrator_events_url(orchestrator_url: str) -> str:
        """Convert an orchestrator base URL into its websocket events endpoint."""
        parsed = urlsplit(orchestrator_url)
        scheme = "wss" if parsed.scheme == "https" else "ws"
        path = f"{parsed.path.rstrip('/')}/v1/orchestrator/events"
        return urlunsplit((scheme, parsed.netloc, path, parsed.query, parsed.fragment))

    @staticmethod
    def _build_relay_ready_message(broker_id: int) -> str:
        """Build the browser-facing message that confirms relay subscription setup."""
        return json.dumps({"message_type": "relay_ready", "broker_id": broker_id})

    @staticmethod
    def _decode_orchestrator_event(message: str | bytes) -> dict[str, Any] | None:
        """Decode a websocket frame into an event dictionary when it is JSON object."""
        if isinstance(message, bytes):
            try:
                message = message.decode("utf-8")
            except UnicodeDecodeError:
                return None
        try:
            payload = json.loads(message)
        except (TypeError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    @staticmethod
    def _normalize_message(message: str | bytes) -> str:
        """Return a text frame suitable for browser websocket forwarding."""
        if isinstance(message, bytes):
            return message.decode("utf-8", errors="replace")
        return message

    @staticmethod
    def _get_orchestrator_event_type(payload: dict[str, Any]) -> str | None:
        """Extract the orchestrator event type from nested or flat payload shapes."""
        event_payload = payload.get("event")
        if isinstance(event_payload, dict):
            event_type = event_payload.get("event_type")
            if isinstance(event_type, str):
                return event_type
        event_type = payload.get("event_type")
        return event_type if isinstance(event_type, str) else None

    @staticmethod
    def _listener_error(broker_id: int, err: Exception) -> ServiceError:
        """Wrap a listener exception in a user-safe service error and log context."""
        msg = f"Failed to consume campaign events for broker {broker_id}: {err}"
        _log.warning(msg)
        return ServiceError(msg)
