from types import SimpleNamespace

import asyncio

import pytest

from ihub_server import main
from ihub_server.core.environment import Settings
from ihub_server.models import Broker
from ihub_server.services.errors import BrokerConnectionError
from ihub_server.models.broker import ProtocolEnum


def _make_broker(auto_connect_enabled: bool) -> Broker:
    return Broker(
        id=1,
        label="test-broker",
        host_ip="127.0.0.1",
        port="1883",
        protocol=ProtocolEnum.MQTT,
        username="user",
        password="pass",
        status="disconnected",
        auto_connect_enabled=auto_connect_enabled,
    )


@pytest.fixture
def seed_broker_settings(monkeypatch):
    settings = Settings(
        _env_file=None,
        BROKER_ENABLED=True,
        BROKER_LABEL="Seed Broker",
        BROKER_HOST="broker.example.com",
        BROKER_PORT=5672,
        BROKER_USERNAME="user",
        BROKER_PASSWORD="pass",
        BROKER_PROTOCOL="amqp0.9.1",
    )
    monkeypatch.setattr(main, "settings", settings)
    return settings


class _FakeSessionContext:
    def __enter__(self):
        return object()

    def __exit__(self, exc_type, exc, traceback):
        return False


def test_seed_broker_skips_connection_when_auto_connect_disabled(monkeypatch, seed_broker_settings):
    broker = _make_broker(auto_connect_enabled=False)
    calls = {"connect": 0}

    class FakeBrokerService:
        def __init__(self, _session):
            pass

        def list_brokers(self, offset: int, limit: int):
            return [broker]

        def update_broker(self, *_args):
            return broker

    class FakeConnectionService:
        def __init__(self, *_args, **_kwargs):
            pass

        def connect_broker(self, *_args):
            calls["connect"] += 1

    monkeypatch.setattr(main, "create_session", lambda: _FakeSessionContext())
    monkeypatch.setattr(main, "BrokerService", FakeBrokerService)
    monkeypatch.setattr(main, "BrokerConnectionService", FakeConnectionService)

    app = SimpleNamespace(state=SimpleNamespace(intersect_clients={}))

    main._seed_broker(app)

    assert calls["connect"] == 0


def test_seed_broker_injects_application_lifecycle_publisher(
    monkeypatch,
    seed_broker_settings,
):
    broker = _make_broker(auto_connect_enabled=True)
    calls = {}

    class FakeBrokerService:
        def __init__(self, _session):
            pass

        def list_brokers(self, offset: int, limit: int):
            return [broker]

        def update_broker(self, *_args):
            return broker

    class FakeConnectionService:
        def __init__(self, *_args, **kwargs):
            calls["publisher"] = kwargs["lifecycle_publisher"]

        def connect_broker(self, broker_id, registry):
            calls["connect"] = (broker_id, registry)

    publisher = lambda _message: None
    registry = {}
    app = SimpleNamespace(
        state=SimpleNamespace(
            intersect_clients=registry,
            lifecycle_message_stream=SimpleNamespace(publish=publisher),
        )
    )
    monkeypatch.setattr(main, "create_session", lambda: _FakeSessionContext())
    monkeypatch.setattr(main, "BrokerService", FakeBrokerService)
    monkeypatch.setattr(main, "BrokerConnectionService", FakeConnectionService)

    main._seed_broker(app)

    assert calls == {"publisher": publisher, "connect": (broker.id, registry)}


def test_seed_broker_creates_broker_from_settings_and_connects(monkeypatch, seed_broker_settings):
    created = []
    connected = []

    class FakeBrokerService:
        def __init__(self, _session):
            pass

        def list_brokers(self, offset: int, limit: int):
            return []

        def create_broker(self, broker_create):
            created.append(broker_create)
            return _make_broker(auto_connect_enabled=True)

    class FakeConnectionService:
        def __init__(self, *_args, **_kwargs):
            pass

        def connect_broker(self, broker_id, _clients):
            connected.append(broker_id)

    monkeypatch.setattr(main, "create_session", lambda: _FakeSessionContext())
    monkeypatch.setattr(main, "BrokerService", FakeBrokerService)
    monkeypatch.setattr(main, "BrokerConnectionService", FakeConnectionService)

    main._seed_broker(
        SimpleNamespace(
            state=SimpleNamespace(
                intersect_clients={},
                lifecycle_message_stream=SimpleNamespace(publish=lambda _message: None),
            )
        )
    )

    assert len(created) == 1
    assert created[0].label == "Seed Broker"
    assert created[0].host_ip == "broker.example.com"
    assert created[0].port == "5672"
    assert created[0].username == "user"
    assert created[0].password == "pass"
    assert connected == [1]


def test_seed_broker_logs_and_continues_when_connection_fails(monkeypatch, seed_broker_settings):
    class FakeBrokerService:
        def __init__(self, _session):
            pass

        def list_brokers(self, offset: int, limit: int):
            return [_make_broker(auto_connect_enabled=True)]

        def update_broker(self, *_args):
            return None

    class FailingConnectionService:
        def __init__(self, *_args, **_kwargs):
            pass

        def connect_broker(self, *_args):
            raise BrokerConnectionError("Broker unable to connect")

    monkeypatch.setattr(main, "create_session", lambda: _FakeSessionContext())
    monkeypatch.setattr(main, "BrokerService", FakeBrokerService)
    monkeypatch.setattr(main, "BrokerConnectionService", FailingConnectionService)

    main._seed_broker(
        SimpleNamespace(
            state=SimpleNamespace(
                intersect_clients={},
                lifecycle_message_stream=SimpleNamespace(publish=lambda _message: None),
            )
        )
    )


def test_lifespan_starts_and_stops_campaign_event_manager(monkeypatch):
    calls = []

    class FakeCampaignEventManager:
        def __init__(self, session_factory):
            calls.append(("init", session_factory))

        async def start(self):
            calls.append(("start", None))

        async def shutdown(self):
            calls.append(("shutdown", None))

    class FakeLifecycleMessageStreamManager:
        async def start(self):
            calls.append(("stream-start", None))

        async def shutdown(self):
            calls.append(("stream-shutdown", None))

    class FakeRedis:
        def ping(self):
            return False

    async def scenario():
        app = SimpleNamespace(state=SimpleNamespace())
        monkeypatch.setattr(main, "CampaignEventManager", FakeCampaignEventManager)
        monkeypatch.setattr(
            main,
            "LifecycleMessageStreamManager",
            FakeLifecycleMessageStreamManager,
        )
        monkeypatch.setattr(main, "init_redis_pool", lambda: _async_value(FakeRedis()))
        monkeypatch.setattr(
            main,
            "settings",
            SimpleNamespace(BROKER_ENABLED=False, ALEMBIC_RUN_MIGRATIONS=False),
        )

        async with main.lifespan(app):
            assert isinstance(app.state.campaign_event_manager, FakeCampaignEventManager)
            assert isinstance(app.state.upload_lock_manager, main.UploadLockManager)

    async def _async_value(value):
        return value

    asyncio.run(scenario())

    assert calls == [
        ("stream-start", None),
        ("init", main.create_session),
        ("start", None),
        ("shutdown", None),
        ("stream-shutdown", None),
    ]


def test_lifespan_starts_stream_before_seed_and_stops_after_broker_clients(monkeypatch):
    calls = []

    class FakeLifecycleMessageStreamManager:
        async def start(self):
            calls.append("stream-start")

        async def shutdown(self):
            calls.append("stream-shutdown")

    class FakeCampaignEventManager:
        def __init__(self, _session_factory):
            pass

        async def start(self):
            calls.append("campaign-start")

        async def shutdown(self):
            calls.append("campaign-shutdown")

    class FakeClient:
        broker_id = 1

        def terminate(self):
            calls.append("broker-terminate")

    class FakeBrokerService:
        def __init__(self, _session):
            pass

        def update_broker_status(self, broker_id, status):
            calls.append(("broker-status", broker_id, status))

    class FakeRedis:
        def ping(self):
            return False

    async def _async_value(value):
        return value

    async def scenario():
        app = SimpleNamespace(state=SimpleNamespace())
        monkeypatch.setattr(
            main,
            "LifecycleMessageStreamManager",
            FakeLifecycleMessageStreamManager,
        )
        monkeypatch.setattr(main, "CampaignEventManager", FakeCampaignEventManager)
        monkeypatch.setattr(main, "BrokerService", FakeBrokerService)
        monkeypatch.setattr(main, "init_redis_pool", lambda: _async_value(FakeRedis()))
        monkeypatch.setattr(main, "create_session", lambda: _FakeSessionContext())
        monkeypatch.setattr(main, "_seed_broker", lambda _app: calls.append("seed"))
        monkeypatch.setattr(
            main,
            "settings",
            SimpleNamespace(BROKER_ENABLED=True, ALEMBIC_RUN_MIGRATIONS=False),
        )

        async with main.lifespan(app):
            app.state.intersect_clients[1] = FakeClient()

    asyncio.run(scenario())

    assert calls == [
        "stream-start",
        "seed",
        "campaign-start",
        "campaign-shutdown",
        ("broker-status", 1, "disconnected"),
        "broker-terminate",
        "stream-shutdown",
    ]
