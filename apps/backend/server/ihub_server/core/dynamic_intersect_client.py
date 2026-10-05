"""
PLEASE NOTE: This file contains internal intersect-sdk library imports.

The INTERSECT-SDK library does NOT promise that internal APIs will not change in "non-breaking" releases.
At time of writing (2024-11-07), it is not anticipated that the used internal APIs will change.

These library interactions cover:
  - expected INTERSECT message structures (not worthwhile to duplicate)
  - simplified APIs for interacting with protocols, etc. (could potentially be duplicated)

"""

import json
import logging
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from intersect_sdk_common import ControlPlaneConfig, ControlPlaneManager, ControlProvider
from intersect_sdk_common.control_plane.messages.lifecycle import (
    LifecycleMessageHeaders,
    validate_lifecycle_message_headers,
)
from pika.exceptions import ConnectionWrongStateError
from pydantic import ValidationError

from .environment import settings

_log = logging.getLogger(__name__)


@dataclass
class BrokerConfig:
    host: str
    port: int
    protocol: ControlProvider
    username: str
    password: str


class DynamicCoreServiceIntersectClient:
    """
    We should NOT use the main IntersectClient or IntersectService class here. As a core service, we interact with INTERSECT
    in a different way than generic services/clients would, and not in a way we should expose in the intersect_sdk library.
    """

    def __init__(
        self,
        config: BrokerConfig,
        broker_id: int,
        save_message: bool = False,
        lifecycle_handler: Callable[[LifecycleMessageHeaders, dict[str, Any], int], None]
        | None = None,
        lifecycle_publisher: Callable[[str], None] | None = None,
    ):
        self.broker_id = broker_id
        self.save_message = save_message
        self._lifecycle_ingest_enabled = save_message
        self._buffer_lifecycle_until_ingest_enabled = (
            lifecycle_handler is not None and not self._lifecycle_ingest_enabled
        )
        self._pending_lifecycle_messages: deque[
            tuple[LifecycleMessageHeaders, dict[str, Any], dict[str, str]]
        ] = deque()
        self._closed = False
        self._lifecycle_handler = lifecycle_handler
        self._lifecycle_publisher = lifecycle_publisher

        self.control_plane_manager = ControlPlaneManager(
            control_configs=[
                ControlPlaneConfig(
                    host=config.host,
                    port=config.port,
                    protocol=config.protocol,
                    username=config.username,
                    password=config.password,
                )
            ]
        )

        # WARNING: multi-level wildcards do not work on MQTT per 4.7.1.2 (https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html#_Toc398718107), so use this hack
        # TODO - will need to change this workaround once we add the registry service
        self.control_plane_manager.add_subscription_channel(
            "*/*/*/*/*/lifecycle",
            {self._handle_message},
            True,
            settings.RESERVED_BROKER_QUEUE_NAME,
        )
        self.control_plane_manager.connect()
        _log.info("Initialized DYNAMIC INTERSECT client.")

    def _handle_message(
        self, message_payload: bytes, content_type: str, raw_headers: dict[str, str]
    ) -> None:
        """Broker callback calls this function when we get a message."""
        if self._closed:
            _log.debug("Ignoring lifecycle message for closed broker client.")
            return

        _log.info("got message.")

        # only look for valid lifecycle messages
        if content_type != "application/json":
            _log.warning(
                "Lifecycle message was expected to be JSON, but got content type %s", content_type
            )
            return
        try:
            headers = validate_lifecycle_message_headers(raw_headers)
            _log.debug("raw headers: %s", headers)
        except ValidationError as e:
            _log.warning("Invalid lifecycle message headers: %s", e)
            return

        try:
            dict_message = json.loads(message_payload)
        except json.JSONDecodeError as e:
            _log.warning("INTERSECT Lifecycle Message was not JSON: %s", e)
            return

        if self._lifecycle_handler:
            if self.save_message and self._lifecycle_ingest_enabled:
                self._handle_lifecycle_advertisement(headers, dict_message, raw_headers)
            elif self._buffer_lifecycle_until_ingest_enabled:
                self._pending_lifecycle_messages.append((headers, dict_message, dict(raw_headers)))

    def _handle_lifecycle_advertisement(
        self,
        headers: LifecycleMessageHeaders,
        message: dict[str, Any],
        raw_headers: dict[str, str],
    ) -> None:
        """Attempt ingest, then notify browsers without stopping broker consumption."""
        if not self._lifecycle_handler:
            return

        # The callback crosses a broker-consumer boundary: any advertisement-specific
        # failure must be isolated so the control-plane thread can keep consuming.
        try:
            self._lifecycle_handler(headers, message, self.broker_id)
        except Exception:  # noqa: BLE001
            _log.exception(
                "Rejected lifecycle advertisement. broker_id=%s message_id=%s source=%s",
                self.broker_id,
                getattr(headers, "message_id", None),
                getattr(headers, "source", None),
            )
        finally:
            if self._lifecycle_publisher:
                envelope = {**raw_headers, "payload": message}
                self._lifecycle_publisher(json.dumps(envelope))

    def is_connected(self) -> bool:
        """Check that we are still subscribed to the message broker."""
        return self.control_plane_manager.is_connected()

    def can_reconnect(self) -> bool:
        """Check that we can potentially resubscribe to the message broker."""
        return not self.control_plane_manager.considered_unrecoverable()

    def enable_lifecycle_ingest(self) -> None:
        """Allow lifecycle callbacks to persist incoming messages."""
        self._lifecycle_ingest_enabled = True
        self.save_message = True
        self._buffer_lifecycle_until_ingest_enabled = False

        if not self._lifecycle_handler:
            self._pending_lifecycle_messages.clear()
            return

        while self._pending_lifecycle_messages:
            headers, message, raw_headers = self._pending_lifecycle_messages.popleft()
            self._handle_lifecycle_advertisement(headers, message, raw_headers)

    def disable_lifecycle_ingest(self) -> None:
        """Prevent lifecycle callbacks from persisting incoming messages."""
        self._lifecycle_ingest_enabled = False
        self.save_message = False
        self._buffer_lifecycle_until_ingest_enabled = False
        self._pending_lifecycle_messages.clear()

    def terminate(self):
        """Part of graceful shutdown."""
        self._closed = True
        self.disable_lifecycle_ingest()
        try:
            self.control_plane_manager.disconnect()
        except ConnectionWrongStateError:
            # The broker already closed the connection (e.g. it refused the
            # login); disconnect() has still stopped the reconnect loop.
            _log.info("Broker %s connection was already closed.", self.broker_id)
