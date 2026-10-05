"""
PLEASE NOTE: This file contains internal intersect-sdk library imports.

The INTERSECT-SDK library does NOT promise that internal APIs will not change in "non-breaking" releases.
At time of writing (2024-11-07), it is not anticipated that the used internal APIs will change.

These library interactions cover:
  - expected INTERSECT message structures (not worthwhile to duplicate)
  - simplified APIs for interacting with protocols, etc. (could potentially be duplicated)

"""

import logging
from asyncio import Queue
from collections import deque

from intersect_sdk_common import ControlPlaneConfig, ControlPlaneManager
from intersect_sdk_common.control_plane.messages.lifecycle import validate_lifecycle_message_headers
from pydantic import ValidationError

from .environment import Settings

_log = logging.getLogger(__name__)


class CoreServiceIntersectClient:
    """
    We should NOT use the main IntersectClient or IntersectService class here. As a core service, we interact with INTERSECT
    in a different way than generic services/clients would, and not in a way we should expose in the intersect_sdk library.
    """

    def __init__(self, settings: Settings):
        self.http_connections: set[Queue[bytes]] = set()
        self.message_history: deque[bytes] = deque(maxlen=20)

        connection = settings.seed_broker_connection()
        self.control_plane_manager = ControlPlaneManager(
            control_configs=[
                ControlPlaneConfig(
                    protocol=connection.protocol,
                    username=connection.username,
                    password=connection.password,
                    port=connection.port,
                    host=connection.host,
                )
            ]
        )

        # WARNING: multi-level wildcards do not work on MQTT per 4.7.1.2 (https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html#_Toc398718107), so use this hack
        # TODO - will need to change this workaround once we add the registry service
        self.control_plane_manager.add_subscription_channel(
            "*/*/*/*/*/lifecycle",
            {self._handle_lifecycle_message},
            True,
            settings.RESERVED_BROKER_QUEUE_NAME,
        )
        self.control_plane_manager.connect()
        _log.info("Initialized BASE INTERSECT client.")

    def _handle_lifecycle_message(
        self, message: bytes, content_type: str, raw_headers: dict[str, str]
    ) -> None:
        """Broker callback calls this function when we get a message."""
        _log.warning("got message")
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

        # NOTE: for now, we will just blindly yield the message; it will always be valid JSON for now
        # This will not always be the case in the future - metadata will always be JSON structured, but raw data may be UTF-8
        # (this will eventually be managed by checking the message's Content-Type)

        for connection in self.http_connections:
            connection.put_nowait(message)
        self.message_history.append(message)

    def add_connection(self) -> Queue:
        """Add an HTTP subscriber."""
        queue: Queue[bytes] = Queue()
        for msg in self.message_history:
            queue.put_nowait(msg)
        self.http_connections.add(queue)

        return queue

    def remove_connection(self, queue: Queue) -> None:
        """Remove an HTTP subscriber."""
        try:
            self.http_connections.remove(queue)
        except KeyError:
            pass

    def is_connected(self) -> bool:
        """Check that we are still subscribed to the message broker."""
        return self.control_plane_manager.is_connected()

    def can_reconnect(self) -> bool:
        """Check that we can potentially resubscribe to the message broker."""
        return not self.control_plane_manager.considered_unrecoverable()

    def terminate(self):
        """Part of graceful shutdown."""
        self.control_plane_manager.disconnect()
