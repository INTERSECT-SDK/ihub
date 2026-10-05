from types import SimpleNamespace

import pytest
from sqlmodel import Session, create_engine, select

from ihub_server.models import Broker, BrokerUpdate, Capability, LifecycleMessage, Service
from ihub_server.models.broker import ProtocolEnum
from ihub_server.services import brokers as brokers_module
from ihub_server.services.brokers import BrokerConnectionService, BrokerService
from ihub_server.services.errors import BrokerConnectionError, ConflictError, NotFoundError


def _make_broker(
    status: str = "disconnected",
    auto_connect_enabled: bool = True,
) -> Broker:
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
        auto_connect_enabled=auto_connect_enabled,
    )


def test_get_broker_missing(monkeypatch):
    service = BrokerService(session=None)
    monkeypatch.setattr(brokers_module.broker_repository, "get_broker", lambda *_args: None)

    with pytest.raises(NotFoundError):
        service.get_broker(1)


def test_update_broker_status_sets_status(monkeypatch):
    service = BrokerService(session=None)
    captured = {}

    def fake_update(broker_id: int, updates: BrokerUpdate):
        captured["broker_id"] = broker_id
        captured["updates"] = updates
        return "updated"

    monkeypatch.setattr(service, "update_broker", fake_update)

    result = service.update_broker_status(5, "connected")

    assert result == "updated"
    assert captured["broker_id"] == 5
    assert captured["updates"].status == "connected"


def test_update_broker_connection_state_sets_status_and_auto_connect(monkeypatch):
    service = BrokerService(session=None)
    captured = {}

    def fake_update(broker_id: int, updates: BrokerUpdate):
        captured["broker_id"] = broker_id
        captured["updates"] = updates
        return "updated"

    monkeypatch.setattr(service, "update_broker", fake_update)

    result = service.update_broker_connection_state(
        5,
        "disconnected",
        auto_connect_enabled=False,
    )

    assert result == "updated"
    assert captured["broker_id"] == 5
    assert captured["updates"].status == "disconnected"
    assert captured["updates"].auto_connect_enabled is False


def test_delete_broker_missing(monkeypatch):
    service = BrokerService(session=None)
    monkeypatch.setattr(brokers_module.broker_repository, "get_broker", lambda *_args: None)

    with pytest.raises(NotFoundError):
        service.delete_broker(2)


def test_connect_broker_conflict():
    broker = _make_broker(status="connected")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)
    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)

    class FakeClient:
        def is_connected(self):
            return True

    with pytest.raises(ConflictError):
        connection_service.connect_broker(broker.id, {broker.id: FakeClient()})


def test_connect_broker_repairs_stale_missing_client_before_reconnect(monkeypatch):
    broker = _make_broker(status="connected", auto_connect_enabled=False)
    status_updates = []
    connection_updates = []

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_status=lambda _id, status: (
            status_updates.append(status) or _make_broker(status=status, auto_connect_enabled=False)
        ),
        update_broker_connection_state=lambda _id, status, auto_connect_enabled: (
            connection_updates.append((status, auto_connect_enabled))
            or _make_broker(
                status=status,
                auto_connect_enabled=auto_connect_enabled,
            )
        ),
    )

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.enabled = False

        def can_reconnect(self):
            return True

        def is_connected(self):
            return True

        def add_connection(self):
            pass

        def enable_lifecycle_ingest(self):
            self.enabled = True

        def terminate(self):
            raise AssertionError("should not terminate healthy new client")

    monkeypatch.setattr(brokers_module, "DynamicCoreServiceIntersectClient", FakeClient)

    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)
    registry = {}
    result = connection_service.connect_broker(broker.id, registry)

    assert result.status == "connected"
    assert result.auto_connect_enabled is True
    assert registry[broker.id].enabled is True
    assert status_updates == ["disconnected"]
    assert connection_updates == [("connected", True)]


def test_connect_broker_disconnects_unhealthy_client_before_reconnect(monkeypatch):
    broker = _make_broker(status="connected", auto_connect_enabled=False)
    status_updates = []
    connection_updates = []

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_status=lambda _id, status: (
            status_updates.append(status) or _make_broker(status=status, auto_connect_enabled=False)
        ),
        update_broker_connection_state=lambda _id, status, auto_connect_enabled: (
            connection_updates.append((status, auto_connect_enabled))
            or _make_broker(
                status=status,
                auto_connect_enabled=auto_connect_enabled,
            )
        ),
    )

    class UnhealthyClient:
        def __init__(self):
            self.http_connections = {"queue"}
            self.removed = []
            self.disabled = False
            self.terminated = False

        def is_connected(self):
            return False

        def disable_lifecycle_ingest(self):
            self.disabled = True

        def remove_connection(self, queue):
            self.removed.append(queue)

        def terminate(self):
            self.terminated = True

    class NewClient:
        def __init__(self, *args, **kwargs):
            self.enabled = False

        def can_reconnect(self):
            return True

        def is_connected(self):
            return True

        def add_connection(self):
            pass

        def enable_lifecycle_ingest(self):
            self.enabled = True

        def terminate(self):
            raise AssertionError("should not terminate healthy new client")

    monkeypatch.setattr(brokers_module, "DynamicCoreServiceIntersectClient", NewClient)

    client = UnhealthyClient()
    registry = {broker.id: client}
    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)

    result = connection_service.connect_broker(broker.id, registry)

    assert result.status == "connected"
    assert result.auto_connect_enabled is True
    assert registry[broker.id].enabled is True
    assert client.disabled is True
    assert client.removed == []
    assert client.terminated is True
    assert status_updates == ["disconnected"]
    assert connection_updates == [("connected", True)]


def test_connect_broker_conflicts_with_healthy_connected_client_without_persisting():
    broker = _make_broker(status="connected")
    updates = []

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_status=lambda _id, status: updates.append(status),
    )

    class FakeClient:
        def is_connected(self):
            return True

    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)

    with pytest.raises(ConflictError):
        connection_service.connect_broker(broker.id, {broker.id: FakeClient()})
    assert updates == []


def test_connect_broker_success(monkeypatch):
    broker = _make_broker(status="disconnected", auto_connect_enabled=False)
    registry: dict[int, object] = {}

    updated = _make_broker(status="connected", auto_connect_enabled=True)
    connection_updates = []

    created_clients = []

    def fake_update_connection_state(
        _broker_id: int,
        status: str,
        auto_connect_enabled: bool,
    ):
        assert created_clients[0].save_message is False
        assert created_clients[0].enabled is False
        connection_updates.append((status, auto_connect_enabled))
        return updated

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_connection_state=fake_update_connection_state,
    )

    class FakeClient:
        def __init__(
            self,
            config,
            broker_id,
            save_message,
            lifecycle_handler,
            lifecycle_publisher,
        ):
            self.config = config
            self.broker_id = broker_id
            self.save_message = save_message
            self.lifecycle_handler = lifecycle_handler
            self.lifecycle_publisher = lifecycle_publisher
            self.added = False
            self.enabled = False

        def can_reconnect(self):
            return True

        def is_connected(self):
            return True

        def add_connection(self):
            self.added = True

        def enable_lifecycle_ingest(self):
            self.enabled = True
            self.save_message = True

        def terminate(self):
            raise AssertionError("should not terminate")

    def fake_client_factory(*args, **kwargs):
        client = FakeClient(*args, **kwargs)
        created_clients.append(client)
        return client

    monkeypatch.setattr(brokers_module, "DynamicCoreServiceIntersectClient", fake_client_factory)

    lifecycle_publisher = lambda _message: None
    connection_service = BrokerConnectionService(
        broker_service,
        session_factory=lambda: None,
        lifecycle_publisher=lifecycle_publisher,
    )
    result = connection_service.connect_broker(broker.id, registry)

    assert result.status == "connected"
    assert result.auto_connect_enabled is True
    assert registry[broker.id] is created_clients[0]
    assert created_clients[0].added is False
    assert created_clients[0].enabled is True
    assert created_clients[0].save_message is True
    assert created_clients[0].lifecycle_publisher is lifecycle_publisher
    assert connection_updates == [("connected", True)]


def test_connect_broker_hides_new_client_until_connected_update_returns(monkeypatch):
    broker = _make_broker(status="disconnected", auto_connect_enabled=False)
    updated = _make_broker(status="connected", auto_connect_enabled=True)
    registry: dict[int, object] = {}
    created_clients = []

    def fake_update_connection_state(
        _broker_id: int,
        status: str,
        auto_connect_enabled: bool,
    ):
        assert status == "connected"
        assert auto_connect_enabled is True
        assert created_clients[0].added is False
        assert broker.id not in registry
        assert broker.id not in registry
        assert created_clients[0].terminated is False
        return updated

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_connection_state=fake_update_connection_state,
    )

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.added = False
            self.enabled = False
            self.terminated = False
            created_clients.append(self)

        def can_reconnect(self):
            return True

        def is_connected(self):
            return True

        def add_connection(self):
            self.added = True

        def enable_lifecycle_ingest(self):
            self.enabled = True

        def disable_lifecycle_ingest(self):
            raise AssertionError("should not clean up successful in-flight client")

        def terminate(self):
            self.terminated = True

    monkeypatch.setattr(brokers_module, "DynamicCoreServiceIntersectClient", FakeClient)

    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)

    result = connection_service.connect_broker(broker.id, registry)

    assert result.status == "connected"
    assert result.auto_connect_enabled is True
    assert registry[broker.id] is created_clients[0]
    assert created_clients[0].added is False
    assert created_clients[0].enabled is True
    assert created_clients[0].terminated is False


def test_connect_broker_unreachable(monkeypatch):
    broker = _make_broker(status="disconnected")

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_status=lambda *_args: broker,
    )

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def can_reconnect(self):
            return False

        def is_connected(self):
            raise AssertionError("should not health check unrecoverable client")

        def add_connection(self):
            raise AssertionError("should not add connection")

        def terminate(self):
            self.terminated = True

    monkeypatch.setattr(brokers_module, "DynamicCoreServiceIntersectClient", FakeClient)

    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)

    with pytest.raises(BrokerConnectionError):
        connection_service.connect_broker(broker.id, {})


def test_connect_broker_status_update_failure_cleans_up_client(monkeypatch):
    broker = _make_broker(status="disconnected")

    def fake_update_connection_state(
        _broker_id: int,
        _status: str,
        auto_connect_enabled: bool,
    ):
        assert auto_connect_enabled is True
        raise RuntimeError("db update failed")

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_connection_state=fake_update_connection_state,
    )

    created_clients = []

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.http_connections = {"queue"}
            self.events = []
            self.enabled = False
            created_clients.append(self)

        def can_reconnect(self):
            return True

        def is_connected(self):
            return True

        def add_connection(self):
            self.events.append("add")

        def enable_lifecycle_ingest(self):
            self.enabled = True

        def disable_lifecycle_ingest(self):
            self.events.append("disable")

        def remove_connection(self, queue):
            self.events.append(f"remove:{queue}")

        def terminate(self):
            self.events.append("terminate")

    monkeypatch.setattr(brokers_module, "DynamicCoreServiceIntersectClient", FakeClient)

    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)
    registry = {}

    with pytest.raises(RuntimeError, match="db update failed"):
        connection_service.connect_broker(broker.id, registry)

    assert registry == {}
    assert created_clients[0].enabled is False
    assert created_clients[0].events == ["disable", "terminate"]


def test_connect_broker_lifecycle_enable_failure_cleans_up_registered_client(
    monkeypatch,
):
    broker = _make_broker(status="disconnected")
    updated = _make_broker(status="connected", auto_connect_enabled=True)
    registry = {}
    created_clients = []

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_connection_state=lambda *_args, **_kwargs: updated,
    )

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.http_connections = {"queue"}
            self.events = []
            created_clients.append(self)

        def can_reconnect(self):
            return True

        def is_connected(self):
            return True

        def add_connection(self):
            self.events.append("add")

        def enable_lifecycle_ingest(self):
            self.events.append("enable")
            raise RuntimeError("lifecycle enable failed")

        def disable_lifecycle_ingest(self):
            self.events.append("disable")

        def remove_connection(self, queue):
            self.events.append(f"remove:{queue}")

        def terminate(self):
            self.events.append("terminate")

    monkeypatch.setattr(brokers_module, "DynamicCoreServiceIntersectClient", FakeClient)

    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)

    with pytest.raises(RuntimeError, match="lifecycle enable failed"):
        connection_service.connect_broker(broker.id, registry)

    assert registry == {}
    assert created_clients[0].events == [
        "enable",
        "disable",
        "terminate",
    ]


def test_connect_broker_health_check_failure_cleans_up(monkeypatch):
    broker = _make_broker(status="disconnected")
    updates = []

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_status=lambda _id, status: updates.append(status),
    )

    created_clients = []

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.added = False
            self.terminated = False
            created_clients.append(self)

        def can_reconnect(self):
            return True

        def is_connected(self):
            return False

        def add_connection(self):
            self.added = True

        def terminate(self):
            self.terminated = True

    monkeypatch.setattr(brokers_module, "DynamicCoreServiceIntersectClient", FakeClient)

    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)
    registry = {}

    with pytest.raises(BrokerConnectionError):
        connection_service.connect_broker(broker.id, registry)

    assert registry == {}
    assert created_clients[0].added is False
    assert created_clients[0].terminated is True
    assert updates == []


def test_connect_broker_reconnects_from_stale_connected_state(monkeypatch):
    broker = _make_broker(status="connected", auto_connect_enabled=False)
    status_updates = []
    connection_updates = []

    def fake_update_status(_broker_id: int, status: str):
        status_updates.append(status)
        return _make_broker(status=status, auto_connect_enabled=False)

    def fake_update_connection_state(
        _broker_id: int,
        status: str,
        auto_connect_enabled: bool,
    ):
        connection_updates.append((status, auto_connect_enabled))
        return _make_broker(
            status=status,
            auto_connect_enabled=auto_connect_enabled,
        )

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_status=fake_update_status,
        update_broker_connection_state=fake_update_connection_state,
    )

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.added = False
            self.enabled = False

        def can_reconnect(self):
            return True

        def is_connected(self):
            return True

        def add_connection(self):
            self.added = True

        def enable_lifecycle_ingest(self):
            self.enabled = True

        def terminate(self):
            raise AssertionError("should not terminate")

    monkeypatch.setattr(brokers_module, "DynamicCoreServiceIntersectClient", FakeClient)

    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)
    registry = {}
    result = connection_service.connect_broker(broker.id, registry)

    assert result.status == "connected"
    assert result.auto_connect_enabled is True
    assert broker.id in registry
    assert registry[broker.id].enabled is True
    assert status_updates == ["disconnected"]
    assert connection_updates == [("connected", True)]


def test_disconnect_broker_not_connected_persists_manual_disconnect():
    broker = _make_broker(status="disconnected", auto_connect_enabled=True)
    updated = _make_broker(status="disconnected", auto_connect_enabled=False)
    connection_updates = []

    def fake_update_connection_state(
        _broker_id: int,
        status: str,
        auto_connect_enabled: bool,
    ):
        connection_updates.append((status, auto_connect_enabled))
        return updated

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_connection_state=fake_update_connection_state,
    )
    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)

    result = connection_service.disconnect_broker(broker.id, {})

    assert result.status == "disconnected"
    assert result.auto_connect_enabled is False
    assert connection_updates == [("disconnected", False)]


def test_connect_broker_removes_stale_runtime_client_for_disconnected_broker(monkeypatch):
    broker = _make_broker(status="disconnected", auto_connect_enabled=False)
    connection_updates = []

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_connection_state=lambda _id, status, auto_connect_enabled: (
            connection_updates.append((status, auto_connect_enabled))
            or _make_broker(
                status=status,
                auto_connect_enabled=auto_connect_enabled,
            )
        ),
    )

    class StaleClient:
        def __init__(self):
            self.http_connections = {"queue"}
            self.events = []

        def disable_lifecycle_ingest(self):
            self.events.append("disable")

        def remove_connection(self, queue):
            self.events.append(f"remove:{queue}")

        def terminate(self):
            self.events.append("terminate")

    class NewClient:
        def __init__(self, *args, **kwargs):
            self.enabled = False

        def can_reconnect(self):
            return True

        def is_connected(self):
            return True

        def add_connection(self):
            pass

        def enable_lifecycle_ingest(self):
            self.enabled = True

        def terminate(self):
            raise AssertionError("should not terminate healthy new client")

    monkeypatch.setattr(brokers_module, "DynamicCoreServiceIntersectClient", NewClient)

    client = StaleClient()
    registry = {broker.id: client}
    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)

    result = connection_service.connect_broker(broker.id, registry)

    assert result.status == "connected"
    assert result.auto_connect_enabled is True
    assert registry[broker.id].enabled is True
    assert client.events == ["disable", "terminate"]
    assert connection_updates == [("connected", True)]


def test_disconnect_broker_removes_runtime_client_for_disconnected_broker():
    broker = _make_broker(status="disconnected", auto_connect_enabled=True)
    updated = _make_broker(status="disconnected", auto_connect_enabled=False)
    connection_updates = []

    def fake_update_connection_state(
        _broker_id: int,
        status: str,
        auto_connect_enabled: bool,
    ):
        connection_updates.append((status, auto_connect_enabled))
        return updated

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_connection_state=fake_update_connection_state,
    )

    class FakeClient:
        def __init__(self):
            self.http_connections = {"queue"}
            self.disabled = False
            self.terminated = False

        def disable_lifecycle_ingest(self):
            self.disabled = True

        def remove_connection(self, _queue):
            pass

        def terminate(self):
            self.terminated = True

    client = FakeClient()
    registry = {broker.id: client}
    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)

    result = connection_service.disconnect_broker(broker.id, registry)

    assert result.status == "disconnected"
    assert result.auto_connect_enabled is False
    assert broker.id not in registry
    assert client.disabled is True
    assert client.terminated is True
    assert connection_updates == [("disconnected", False)]


def test_disconnect_broker_stale_missing_client_returns_disconnected():
    broker = _make_broker(status="connected")
    updated = _make_broker(status="disconnected", auto_connect_enabled=False)
    connection_updates = []

    def fake_update_connection_state(
        _broker_id: int,
        status: str,
        auto_connect_enabled: bool,
    ):
        connection_updates.append((status, auto_connect_enabled))
        return updated

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_status=lambda _id, _status: updated,
        update_broker_connection_state=fake_update_connection_state,
    )
    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)

    result = connection_service.disconnect_broker(broker.id, {})

    assert result.status == "disconnected"
    assert result.auto_connect_enabled is False
    assert connection_updates == [("disconnected", False)]


def test_disconnect_broker_success():
    broker = _make_broker(status="connected")

    updated = _make_broker(status="disconnected", auto_connect_enabled=False)
    connection_updates = []

    def fake_update_connection_state(
        _broker_id: int,
        status: str,
        auto_connect_enabled: bool,
    ):
        connection_updates.append((status, auto_connect_enabled))
        return updated

    broker_service = SimpleNamespace(
        get_broker=lambda _id: broker,
        update_broker_connection_state=fake_update_connection_state,
    )

    class FakeClient:
        def __init__(self):
            self.http_connections = {"queue"}
            self.removed = None
            self.disabled = False
            self.terminated = False

        def is_connected(self):
            return True

        def disable_lifecycle_ingest(self):
            self.disabled = True

        def remove_connection(self, queue):
            self.removed = queue

        def terminate(self):
            self.terminated = True

    client = FakeClient()
    registry = {broker.id: client}

    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)
    result = connection_service.disconnect_broker(broker.id, registry)

    assert result.status == "disconnected"
    assert result.auto_connect_enabled is False
    assert broker.id not in registry
    assert client.disabled is True
    assert client.removed is None
    assert client.terminated is True
    assert connection_updates == [("disconnected", False)]


def test_terminate_client_disables_lifecycle_before_disconnect():
    broker = _make_broker(status="connected")
    broker_service = SimpleNamespace(get_broker=lambda _id: broker)

    class FakeClient:
        def __init__(self):
            self.http_connections = {"queue"}
            self.events = []

        def disable_lifecycle_ingest(self):
            self.events.append("disable")

        def remove_connection(self, queue):
            self.events.append(f"remove:{queue}")

        def terminate(self):
            self.events.append("terminate")

    client = FakeClient()
    registry = {broker.id: client}
    connection_service = BrokerConnectionService(broker_service, session_factory=lambda: None)

    connection_service._terminate_client(broker.id, registry)

    assert broker.id not in registry
    assert client.events == ["disable", "terminate"]


def test_list_brokers(monkeypatch):
    service = BrokerService(session=None)
    monkeypatch.setattr(brokers_module.broker_repository, "list_brokers", lambda *_a: ["b"])

    assert service.list_brokers(0, 10) == ["b"]


def test_get_broker_success(monkeypatch):
    service = BrokerService(session=None)
    broker = _make_broker()
    monkeypatch.setattr(brokers_module.broker_repository, "get_broker", lambda *_a: broker)

    assert service.get_broker(broker.id) == broker


def test_create_broker(monkeypatch):
    service = BrokerService(session=None)
    broker = _make_broker()

    monkeypatch.setattr(brokers_module.broker_repository, "create_broker", lambda *_a: broker)

    assert service.create_broker(broker) == broker


def test_update_broker_success(monkeypatch):
    service = BrokerService(session=None)
    broker = _make_broker()
    monkeypatch.setattr(brokers_module.broker_repository, "get_broker", lambda *_a: broker)
    monkeypatch.setattr(
        brokers_module.broker_repository,
        "update_broker",
        lambda *_a: "updated",
    )

    assert service.update_broker(broker.id, BrokerUpdate()) == "updated"


def test_delete_broker_success(monkeypatch):
    class FakeExecResult:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

    class FakeSession:
        def __init__(self):
            self.exec_calls = 0

        def exec(self, _statement):
            self.exec_calls += 1
            if self.exec_calls == 1:
                return FakeExecResult([SimpleNamespace(id=123)])
            return FakeExecResult([])

    fake_session = FakeSession()
    service = BrokerService(session=fake_session)
    broker = _make_broker()
    monkeypatch.setattr(brokers_module.broker_repository, "get_broker", lambda *_a: broker)

    calls = {}

    def fake_delete(_session, broker_obj):
        calls["broker"] = broker_obj

    monkeypatch.setattr(brokers_module.broker_repository, "delete_broker", fake_delete)

    service.delete_broker(broker.id)

    assert calls["broker"] == broker
    assert fake_session.exec_calls == 4


def test_delete_broker_preserves_equivalent_lifecycle_row_owned_by_other_broker(monkeypatch):
    engine = create_engine("sqlite://")
    Service.__table__.create(engine)
    Capability.__table__.create(engine)
    LifecycleMessage.__table__.create(engine)

    broker_1 = _make_broker()
    monkeypatch.setattr(
        brokers_module.broker_repository,
        "get_broker",
        lambda *_args: broker_1,
    )
    monkeypatch.setattr(
        brokers_module.broker_repository,
        "delete_broker",
        lambda session, _broker: session.commit(),
    )

    with Session(engine) as session:
        session.add_all(
            [
                LifecycleMessage(
                    message_id="broker-1-message",
                    broker_id=1,
                    organization="org",
                    facility="facility",
                    system="system",
                    service="service",
                    sdk_capability_name="capability",
                    endpoint_names="endpoint",
                ),
                LifecycleMessage(
                    message_id="broker-2-message",
                    broker_id=2,
                    organization="org",
                    facility="facility",
                    system="system",
                    service="service",
                    sdk_capability_name="capability",
                    endpoint_names="endpoint",
                ),
            ]
        )
        session.commit()

        BrokerService(session).delete_broker(1)

        remaining = session.exec(select(LifecycleMessage)).all()
        assert len(remaining) == 1
        assert remaining[0].broker_id == 2
        assert remaining[0].message_id == "broker-2-message"

    engine.dispose()
