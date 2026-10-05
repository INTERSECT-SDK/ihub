"""Service layer for Service CRUD and lifecycle upserts."""

from sqlmodel import Session

from ihub_server.models import Service, ServiceCreate, ServiceUpdate
from ihub_server.repositories import services as service_repository
from ihub_server.services.errors import NotFoundError
from ihub_server.utils.lifecycle_message import ParsedBrokerMessage


class ServiceService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_services(self, offset: int, limit: int) -> list[Service]:
        return service_repository.list_services(self._session, offset, limit)

    def list_services_for_broker(self, broker_id: int) -> list[Service]:
        return service_repository.list_services_for_broker(self._session, broker_id)

    def get_service(self, service_id: int) -> Service:
        service = service_repository.get_service(self._session, service_id)
        if not service:
            msg = "Service not found"
            raise NotFoundError(msg)
        return service

    def get_service_by_name(self, service_name: str) -> Service | None:
        return service_repository.get_service_by_name(self._session, service_name)

    def create_service(self, service: ServiceCreate) -> Service:
        return service_repository.create_service(self._session, service)

    def update_service(self, service_id: int, updates: ServiceUpdate) -> Service:
        service = service_repository.get_service(self._session, service_id)
        if not service:
            msg = "Service not found"
            raise NotFoundError(msg)
        return service_repository.update_service(self._session, service, updates)

    def upsert_from_lifecycle(
        self,
        parsed_message: ParsedBrokerMessage,
        broker_id: int,
        *,
        commit: bool = True,
    ) -> Service:
        h = parsed_message.hierarchy
        existing = self.get_service_by_name(h.service)
        if existing:
            updates = ServiceUpdate()
            updates.broker_id = broker_id
            updates.last_lifecycle_message = parsed_message.created_at
            updates.organization = h.organization
            updates.facility = h.facility
            updates.system = h.system
            updates.subsystem = h.subsystem
            if commit:
                return service_repository.update_service(self._session, existing, updates)
            return service_repository.update_service(
                self._session,
                existing,
                updates,
                commit=False,
            )

        new_service = ServiceCreate(
            name=h.service,
            created_at=parsed_message.created_at,
            broker_id=broker_id,
            organization=h.organization,
            facility=h.facility,
            system=h.system,
            subsystem=h.subsystem,
        )
        if commit:
            return service_repository.create_service(self._session, new_service)
        return service_repository.create_service(self._session, new_service, commit=False)
