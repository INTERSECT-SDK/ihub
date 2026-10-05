"""Service layer for Capability CRUD and lifecycle-driven upserts."""

from sqlmodel import Session

from ihub_server.models import (
    Capability,
    CapabilityCreate,
    CapabilityPublic,
    CapabilityUpdate,
    Service,
)
from ihub_server.repositories import capabilities as capability_repository
from ihub_server.services.errors import NotFoundError
from ihub_server.utils.lifecycle_message import ParsedBrokerMessage


class CapabilityService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_capabilities(self, offset: int, limit: int) -> list[CapabilityPublic]:
        return capability_repository.list_capabilities(self._session, offset, limit)

    def list_capabilities_for_service(
        self,
        service_id: int,
        offset: int,
        limit: int,
    ) -> list[CapabilityPublic]:
        return capability_repository.list_capabilities_for_service(
            self._session,
            service_id,
            offset,
            limit,
        )

    def get_capability(self, capability_id: int) -> CapabilityPublic:
        capability = capability_repository.get_capability_with_health(
            self._session,
            capability_id,
        )
        if not capability:
            msg = "Capability not found"
            raise NotFoundError(msg)
        return capability

    def create_capability(self, capability: CapabilityCreate) -> Capability:
        return capability_repository.create_capability(self._session, capability)

    def update_capability(self, capability_id: int, updates: CapabilityUpdate) -> Capability:
        capability = capability_repository.get_capability(self._session, capability_id)
        if not capability:
            msg = "Capability not found"
            raise NotFoundError(msg)
        return capability_repository.update_capability(self._session, capability, updates)

    def upsert_from_lifecycle(
        self,
        parsed_message: ParsedBrokerMessage,
        service: Service,
        *,
        commit: bool = True,
    ) -> Capability | None:
        if not service.id:
            return None

        capability = CapabilityCreate(
            name=parsed_message.sdk_capability_name,
            service_id=service.id,
            broker_id=service.broker_id,
            last_lifecycle_message=parsed_message.created_at,
            endpoints_schema=parsed_message.endpoints_schema,
        )
        if commit:
            return capability_repository.upsert_capability(self._session, capability)
        return capability_repository.upsert_capability(
            self._session,
            capability,
            commit=False,
        )
