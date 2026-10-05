"""Service layer for broker CRUD and intersect broker connections."""

import logging
from collections.abc import Callable
from uuid import UUID

import httpx
from sqlmodel import Session, col, delete, select

from ihub_server.core.dynamic_intersect_client import (
    BrokerConfig,
    DynamicCoreServiceIntersectClient,
)
from ihub_server.models import (
    Broker,
    BrokerCreate,
    BrokerUpdate,
    Capability,
    LifecycleMessage,
    OrchestratorHealthStatus,
    Service,
)
from ihub_server.repositories import brokers as broker_repository
from ihub_server.services.errors import (
    BrokerConnectionError,
    ConflictError,
    NotFoundError,
)
from ihub_server.services.lifecycle import LifecycleIngestService

_log = logging.getLogger("ihub-server")


class BrokerService:
    """Coordinate broker persistence operations and related cleanup."""

    def __init__(self, session: Session) -> None:
        """Initialize the service with a database session."""
        self._session = session

    def list_brokers(self, offset: int, limit: int, project_id: UUID | None = None) -> list[Broker]:
        """Return a paginated list of brokers, optionally scoped to a project."""
        return broker_repository.list_brokers(self._session, offset, limit, project_id)

    def get_broker(self, broker_id: int) -> Broker:
        """Return a broker by id or raise when it does not exist."""
        broker = broker_repository.get_broker(self._session, broker_id)
        if not broker:
            msg = "Broker not found"
            raise NotFoundError(msg)
        return broker

    def create_broker(self, broker: BrokerCreate) -> Broker:
        """Persist a new broker from validated creation data."""
        return broker_repository.create_broker(self._session, broker)

    def update_broker(self, broker_id: int, updates: BrokerUpdate) -> Broker:
        """Apply partial updates to an existing broker."""
        broker = broker_repository.get_broker(self._session, broker_id)
        if not broker:
            msg = "Broker not found"
            raise NotFoundError(msg)
        return broker_repository.update_broker(self._session, broker, updates)

    def update_broker_status(self, broker_id: int, status: str) -> Broker:
        """Set the persisted connection status for a broker."""
        updates = BrokerUpdate()
        updates.status = status
        return self.update_broker(broker_id, updates)

    def update_broker_connection_state(
        self,
        broker_id: int,
        status: str,
        auto_connect_enabled: bool,
    ) -> Broker:
        """Set persisted status and explicit auto-connect preference together."""
        updates = BrokerUpdate()
        updates.status = status
        updates.auto_connect_enabled = auto_connect_enabled
        return self.update_broker(broker_id, updates)

    def delete_broker(self, broker_id: int) -> None:
        """Delete a broker and its dependent services, capabilities, and messages."""
        broker = broker_repository.get_broker(self._session, broker_id)
        if not broker:
            msg = "Broker not found"
            raise NotFoundError(msg)

        # Delete all capabilities for services associated with this broker
        services = self._session.exec(
            select(Service).where(col(Service.broker_id) == broker_id)
        ).all()
        service_ids = [s.id for s in services]
        if service_ids:
            self._session.exec(
                delete(Capability).where(col(Capability.service_id).in_(service_ids))
            )

        # Delete all services associated with this broker
        self._session.exec(delete(Service).where(col(Service.broker_id) == broker_id))

        # Delete all lifecycle messages associated with this broker
        self._session.exec(
            delete(LifecycleMessage).where(col(LifecycleMessage.broker_id) == broker_id)
        )

        # Finally, delete the broker itself
        broker_repository.delete_broker(self._session, broker)


class BrokerOrchestratorHealthService:
    """Check orchestrator reachability without changing broker state."""

    def __init__(self, broker_service: BrokerService) -> None:
        """Initialize the health checker with private broker record access."""
        self._broker_service = broker_service

    async def check(self, broker_id: int) -> OrchestratorHealthStatus:
        """Return the current HTTP health status for a broker's orchestrator."""
        broker = self._broker_service.get_broker(broker_id)
        if not broker.orchestrator_url:
            status = OrchestratorHealthStatus.NOT_CONFIGURED
            self._log_status(broker_id, status)
            return status

        health_url = f"{broker.orchestrator_url.rstrip('/')}/v1/healthcheck"
        headers = {}
        if broker.orchestrator_api_key:
            headers["Authorization"] = broker.orchestrator_api_key

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(health_url, headers=headers)
            status = (
                OrchestratorHealthStatus.CONNECTED
                if response.is_success
                else OrchestratorHealthStatus.DISCONNECTED
            )
        except (httpx.HTTPError, httpx.InvalidURL):
            status = OrchestratorHealthStatus.DISCONNECTED

        self._log_status(broker_id, status)
        return status

    @staticmethod
    def _log_status(broker_id: int, status: OrchestratorHealthStatus) -> None:
        _log.info("Orchestrator health for broker %s: %s", broker_id, status.value)


class BrokerConnectionService:
    """Manage runtime Intersect clients and synchronize broker connection state."""

    def __init__(
        self,
        broker_service: BrokerService,
        session_factory: Callable[[], Session],
        lifecycle_publisher: Callable[[str], None] | None = None,
    ) -> None:
        """Initialize connection management with persistence and ingest services."""
        self._broker_service = broker_service
        self._lifecycle_ingest = LifecycleIngestService(session_factory)
        self._lifecycle_publisher = lifecycle_publisher

    def connect_broker(
        self,
        broker_id: int,
        client_registry: dict[int, DynamicCoreServiceIntersectClient],
    ) -> Broker:
        """Connect a broker, register its client, and persist the connected status."""
        broker = self._broker_service.get_broker(broker_id)
        broker = self._reconcile_broker_for_lifecycle_operation(broker, client_registry)
        client = client_registry.get(broker_id)

        if client and self._is_client_connected(broker, client):
            msg = "Broker is already connected"
            raise ConflictError(msg)

        if client:
            self._log_reconciliation(
                broker=broker,
                registry_present=True,
                health_check=False,
                message="Removing unhealthy broker client before reconnect.",
            )
            self._terminate_client(broker_id, client_registry)
            broker = self._broker_service.update_broker_status(broker_id, "disconnected")

        if broker.status == "connected":
            msg = "Broker is already connected"
            raise ConflictError(msg)

        config = BrokerConfig(
            host=broker.host_ip,
            port=int(broker.port),
            protocol=broker.protocol.value,
            username=broker.username,
            password=broker.password,
        )

        client = DynamicCoreServiceIntersectClient(
            config=config,
            broker_id=broker_id,
            save_message=False,
            lifecycle_handler=self._lifecycle_ingest.handle_lifecycle_message,
            lifecycle_publisher=self._lifecycle_publisher,
        )

        if not client.can_reconnect():
            self._log_reconciliation(
                broker=broker,
                registry_present=False,
                health_check=False,
                message="Created broker client failed reconnect validation.",
            )
            self._terminate_new_client(client)
            msg = "Broker unable to connect"
            raise BrokerConnectionError(msg)

        if not self._is_client_connected(broker, client):
            self._log_reconciliation(
                broker=broker,
                registry_present=False,
                health_check=False,
                message="Created broker client failed connection health check.",
            )
            self._terminate_new_client(client)
            msg = "Broker unable to connect"
            raise BrokerConnectionError(msg)

        try:
            broker = self._broker_service.update_broker_connection_state(
                broker_id,
                "connected",
                auto_connect_enabled=True,
            )
        except Exception:
            self._terminate_new_client(client)
            raise

        client_registry[broker_id] = client

        try:
            client.enable_lifecycle_ingest()
        except Exception:
            self._terminate_client(broker_id, client_registry)
            raise

        return broker

    def disconnect_broker(
        self,
        broker_id: int,
        client_registry: dict[int, DynamicCoreServiceIntersectClient],
    ) -> Broker:
        """Disconnect a broker, terminate its client, and persist the new status."""
        broker = self._broker_service.get_broker(broker_id)
        broker = self._reconcile_broker_for_lifecycle_operation(broker, client_registry)

        client = client_registry.get(broker_id)
        if client:
            self._terminate_client(broker_id, client_registry)

        return self._broker_service.update_broker_connection_state(
            broker_id,
            "disconnected",
            auto_connect_enabled=False,
        )

    def _reconcile_broker_for_lifecycle_operation(
        self,
        broker: Broker,
        client_registry: dict[int, DynamicCoreServiceIntersectClient],
    ) -> Broker:
        """Repair local runtime and persisted state before a lifecycle operation."""
        if broker.id is None:
            msg = "Broker id missing"
            raise BrokerConnectionError(msg)

        broker_id = broker.id
        client = client_registry.get(broker_id)

        if broker.status != "connected":
            if client:
                self._log_reconciliation(
                    broker=broker,
                    registry_present=True,
                    health_check=None,
                    message="Persisted broker status is disconnected with a runtime client.",
                )
                self._terminate_client(broker_id, client_registry)
                if broker.status != "disconnected":
                    return self._broker_service.update_broker_status(broker_id, "disconnected")
            return broker

        if not client:
            self._log_reconciliation(
                broker=broker,
                registry_present=False,
                health_check=None,
                message="Persisted broker status is connected without a runtime client.",
            )
            return self._broker_service.update_broker_status(broker_id, "disconnected")

        is_connected = self._is_client_connected(broker, client)
        if is_connected:
            return broker

        self._log_reconciliation(
            broker=broker,
            registry_present=True,
            health_check=False,
            message="Runtime broker client is unhealthy.",
        )
        self._terminate_client(broker_id, client_registry)
        return self._broker_service.update_broker_status(broker_id, "disconnected")

    def _is_client_connected(
        self,
        broker: Broker,
        client: DynamicCoreServiceIntersectClient,
    ) -> bool:
        """Return whether a client passes its connection health check."""
        try:
            return client.is_connected()
        except (AttributeError, RuntimeError, ValueError):
            self._log_reconciliation(
                broker=broker,
                registry_present=True,
                health_check=False,
                message="Broker client health check raised an exception.",
            )
            _log.exception("Broker client health check failed.")
            return False

    def _terminate_client(
        self,
        broker_id: int,
        client_registry: dict[int, DynamicCoreServiceIntersectClient],
    ) -> None:
        """Remove a registered client and close all of its active connections."""
        client = client_registry.get(broker_id)
        if not client:
            return

        try:
            self._disable_client_lifecycle_ingest(client)
            self._terminate_new_client(client, disable_lifecycle_ingest=False)
        finally:
            client_registry.pop(broker_id, None)

    def _terminate_new_client(
        self,
        client: DynamicCoreServiceIntersectClient,
        disable_lifecycle_ingest: bool = True,
    ) -> None:
        """Terminate an unregistered or already deregistered client safely."""
        try:
            if disable_lifecycle_ingest:
                self._disable_client_lifecycle_ingest(client)
            client.terminate()
        except (AttributeError, RuntimeError, ValueError):
            _log.exception("Failed to terminate broker client during cleanup.")

    def _disable_client_lifecycle_ingest(
        self,
        client: DynamicCoreServiceIntersectClient,
    ) -> None:
        """Disable lifecycle persistence before runtime client cleanup."""
        try:
            client.disable_lifecycle_ingest()
        except AttributeError:
            _log.debug("Broker client does not expose lifecycle ingest controls.")
        except (RuntimeError, ValueError):
            _log.exception("Failed to disable lifecycle ingest during cleanup.")

    def _log_reconciliation(
        self,
        broker: Broker,
        registry_present: bool,
        health_check: bool | None,
        message: str,
    ) -> None:
        """Log details about broker status reconciliation decisions."""
        _log.warning(
            "%s broker_id=%s label=%s persisted_status=%s registry_present=%s health_check=%s",
            message,
            broker.id,
            broker.label,
            broker.status,
            registry_present,
            health_check,
        )
