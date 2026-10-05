"""Services for lifecycle message persistence and ingest processing."""

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from intersect_sdk_common.control_plane.messages.lifecycle import LifecycleMessageHeaders
from sqlmodel import Session

from ihub_server.models import LifecycleMessage
from ihub_server.repositories import brokers as broker_repository
from ihub_server.repositories import lifecycle_messages as lifecycle_repository
from ihub_server.services.capabilities import CapabilityService
from ihub_server.services.services import ServiceService
from ihub_server.utils.lifecycle_message import (
    LifecycleMessageIdentity,
    ParsedBrokerMessage,
    extract_lifecycle_identity,
    parse_broker_message,
)

_log = logging.getLogger("ihub-server")

LIFECYCLE_PARSING_ERROR = "The lifecycle advertisement could not be parsed."
LIFECYCLE_PERSISTENCE_ERROR = "The lifecycle advertisement could not be saved."


class LifecycleMessageService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_messages(
        self, broker_id: int | None, offset: int, limit: int
    ) -> list[LifecycleMessage]:
        return lifecycle_repository.list_lifecycle_messages(self._session, broker_id, offset, limit)

    def create_from_parsed(
        self,
        parsed_message: ParsedBrokerMessage,
        *,
        commit: bool = True,
    ):
        if commit:
            return lifecycle_repository.create_lifecycle_message(
                self._session,
                parsed_message,
            )
        return lifecycle_repository.create_lifecycle_message(
            self._session,
            parsed_message,
            commit=False,
        )

    def create_from_message(
        self,
        message_headers: LifecycleMessageHeaders,
        message_payload: dict[str, Any],
        broker_id: int,
    ):
        parsed_message = parse_broker_message(message_headers, message_payload, broker_id)
        if parsed_message is None:
            return None
        return self.create_from_parsed(parsed_message)


class LifecycleIngestService:
    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory

    def handle_lifecycle_message(
        self,
        message_headers: LifecycleMessageHeaders,
        message_payload: dict[str, Any],
        broker_id: int,
    ) -> None:
        identity = extract_lifecycle_identity(message_headers, message_payload, broker_id)
        try:
            parsed_message = parse_broker_message(message_headers, message_payload, broker_id)
        except Exception:
            self._record_ingest_error(identity, LIFECYCLE_PARSING_ERROR)
            raise

        if parsed_message is None:
            return

        try:
            with self._session_factory() as session:
                broker = broker_repository.get_broker(session, broker_id)
                if not broker or broker.status != "connected":
                    _log.info(
                        "Skipping lifecycle message for inactive broker. broker_id=%s status=%s",
                        broker_id,
                        getattr(broker, "status", None),
                    )
                    return

                lifecycle_service = LifecycleMessageService(session)
                service_service = ServiceService(session)
                capability_service = CapabilityService(session)

                lifecycle_service.create_from_parsed(parsed_message, commit=False)
                service = service_service.upsert_from_lifecycle(
                    parsed_message,
                    broker_id,
                    commit=False,
                )
                if service and service.id:
                    capability_service.upsert_from_lifecycle(
                        parsed_message,
                        service,
                        commit=False,
                    )
                session.commit()
        except Exception:
            self._record_ingest_error(identity, LIFECYCLE_PERSISTENCE_ERROR)
            raise

    def _record_ingest_error(
        self,
        identity: LifecycleMessageIdentity | None,
        error_message: str,
    ) -> None:
        if identity is None:
            return

        try:
            with self._session_factory() as session:
                lifecycle_repository.record_ingest_error(
                    session,
                    identity,
                    error_message,
                    datetime.now(UTC),
                )
        except Exception:  # noqa: BLE001
            _log.exception(
                "Failed to record lifecycle ingest health. broker_id=%s message_id=%s source=%s",
                identity.broker_id,
                identity.message_id,
                identity.hierarchy,
            )
