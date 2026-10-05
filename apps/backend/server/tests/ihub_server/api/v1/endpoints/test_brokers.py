from types import SimpleNamespace

import pytest

from ihub_server.api.deps import (
    get_broker_connection_service,
    get_broker_orchestrator_health_service,
    get_broker_service,
    get_principal,
)
from ihub_server.models import Broker, OrchestratorHealthStatus
from ihub_server.models.broker import ProtocolEnum
from ihub_server.services.errors import NotFoundError


def _principal():
    return SimpleNamespace(subject_id="subject", email="user@example.com")


def _broker(status: str = "disconnected") -> Broker:
    return Broker(
        id=1,
        label="test-broker",
        host_ip="127.0.0.1",
        port="1883",
        protocol=ProtocolEnum.MQTT,
        username="user",
        password="pass",
        orchestrator_url="http://orchestrator",
        orchestrator_api_key="key",
        status=status,
        auto_connect_enabled=True,
    )


def _forbid_connection_service():
    raise AssertionError("read endpoint should not resolve BrokerConnectionService")


def test_read_brokers_returns_persisted_records_without_connection_service(client, app):
    captured = {}

    class FakeBrokerService:
        def list_brokers(self, offset, limit, project_id):
            captured["offset"] = offset
            captured["limit"] = limit
            captured["project_id"] = project_id
            return [_broker(status="connected")]

    app.dependency_overrides[get_principal] = _principal
    app.dependency_overrides[get_broker_service] = lambda: FakeBrokerService()
    app.dependency_overrides[get_broker_connection_service] = _forbid_connection_service
    app.state.intersect_clients = {}
    try:
        response = client.get("/api/v1/brokers/?offset=5&limit=10")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()[0]["status"] == "connected"
    assert captured == {
        "offset": 5,
        "limit": 10,
        "project_id": None,
    }


def test_read_broker_returns_persisted_record_without_connection_service(client, app):
    class FakeBrokerService:
        def get_broker(self, broker_id):
            assert broker_id == 1
            return _broker(status="connected")

    app.dependency_overrides[get_principal] = _principal
    app.dependency_overrides[get_broker_service] = lambda: FakeBrokerService()
    app.dependency_overrides[get_broker_connection_service] = _forbid_connection_service
    app.state.intersect_clients = {}
    try:
        response = client.get("/api/v1/brokers/1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["status"] == "connected"


def test_read_broker_maps_missing_broker_to_404(client, app):
    class FakeBrokerService:
        def get_broker(self, _broker_id):
            raise NotFoundError("Broker not found")

    app.dependency_overrides[get_principal] = _principal
    app.dependency_overrides[get_broker_service] = lambda: FakeBrokerService()
    app.dependency_overrides[get_broker_connection_service] = _forbid_connection_service
    try:
        response = client.get("/api/v1/brokers/404")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json() == {"detail": "Broker not found"}


@pytest.mark.parametrize(
    "status",
    [
        OrchestratorHealthStatus.CONNECTED,
        OrchestratorHealthStatus.DISCONNECTED,
        OrchestratorHealthStatus.NOT_CONFIGURED,
    ],
)
def test_read_orchestrator_health_returns_service_status(client, app, status):
    class FakeHealthService:
        async def check(self, broker_id):
            assert broker_id == 1
            return status

    app.dependency_overrides[get_principal] = _principal
    app.dependency_overrides[get_broker_orchestrator_health_service] = lambda: FakeHealthService()
    try:
        response = client.get("/api/v1/brokers/1/orchestrator-health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"status": status.value}


def test_read_orchestrator_health_maps_missing_broker_to_404(client, app):
    class FakeHealthService:
        async def check(self, _broker_id):
            raise NotFoundError("Broker not found")

    app.dependency_overrides[get_principal] = _principal
    app.dependency_overrides[get_broker_orchestrator_health_service] = lambda: FakeHealthService()
    try:
        response = client.get("/api/v1/brokers/404/orchestrator-health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json() == {"detail": "Broker not found"}


def test_read_orchestrator_health_allows_authenticated_users(client, app):
    class FakeHealthService:
        async def check(self, _broker_id):
            return OrchestratorHealthStatus.CONNECTED

    app.dependency_overrides[get_principal] = _principal
    app.dependency_overrides[get_broker_orchestrator_health_service] = lambda: FakeHealthService()
    try:
        response = client.get("/api/v1/brokers/1/orchestrator-health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
