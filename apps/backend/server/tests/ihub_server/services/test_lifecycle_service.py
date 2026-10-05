import json
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlmodel import Session, create_engine, select

from ihub_server.models import Capability, LifecycleMessage, Service
from ihub_server.models.service import Hierarchy
from ihub_server.services import lifecycle as lifecycle_module
from ihub_server.services.lifecycle import LifecycleIngestService, LifecycleMessageService
from ihub_server.utils.lifecycle_message import ParsedBrokerMessage


def test_create_from_message_returns_none(monkeypatch):
    service = LifecycleMessageService(session=None)
    monkeypatch.setattr(lifecycle_module, "parse_broker_message", lambda *_a: None)

    assert service.create_from_message({}, {}, broker_id=1) is None


def test_create_from_message_persists(monkeypatch):
    service = LifecycleMessageService(session=None)
    parsed = SimpleNamespace()
    monkeypatch.setattr(lifecycle_module, "parse_broker_message", lambda *_a: parsed)
    monkeypatch.setattr(
        lifecycle_module.lifecycle_repository,
        "create_lifecycle_message",
        lambda *_a: "created",
    )

    assert service.create_from_message({}, {}, broker_id=1) == "created"


def test_handle_lifecycle_message_skips_when_unparsed(monkeypatch):
    calls = []

    monkeypatch.setattr(lifecycle_module, "parse_broker_message", lambda *_a: None)

    @contextmanager
    def session_factory():
        calls.append("session")
        yield None

    service = LifecycleIngestService(session_factory)

    service.handle_lifecycle_message({}, {}, broker_id=1)

    assert calls == []


def test_handle_lifecycle_message_upserts(monkeypatch):
    parsed = SimpleNamespace()
    monkeypatch.setattr(lifecycle_module, "parse_broker_message", lambda *_a: parsed)
    monkeypatch.setattr(
        lifecycle_module.broker_repository,
        "get_broker",
        lambda *_a: SimpleNamespace(status="connected"),
    )

    lifecycle_calls = []
    service_calls = []
    capability_calls = []

    class FakeLifecycleService:
        def __init__(self, _session):
            pass

        def create_from_parsed(self, _msg, **_kwargs):
            lifecycle_calls.append("created")

    class FakeServiceService:
        def __init__(self, _session):
            pass

        def upsert_from_lifecycle(self, _msg, _broker_id, **_kwargs):
            service_calls.append("upsert")
            return SimpleNamespace(id=1)

    class FakeCapabilityService:
        def __init__(self, _session):
            pass

        def upsert_from_lifecycle(self, _msg, _service, **_kwargs):
            capability_calls.append("upsert")

    monkeypatch.setattr(lifecycle_module, "LifecycleMessageService", FakeLifecycleService)
    monkeypatch.setattr(lifecycle_module, "ServiceService", FakeServiceService)
    monkeypatch.setattr(lifecycle_module, "CapabilityService", FakeCapabilityService)

    @contextmanager
    def session_factory():
        yield SimpleNamespace(commit=lambda: None)

    service = LifecycleIngestService(session_factory)

    service.handle_lifecycle_message({}, {}, broker_id=1)

    assert lifecycle_calls == ["created"]
    assert service_calls == ["upsert"]
    assert capability_calls == ["upsert"]


def test_handle_lifecycle_message_skips_when_broker_disconnected(monkeypatch):
    parsed = SimpleNamespace()
    monkeypatch.setattr(lifecycle_module, "parse_broker_message", lambda *_a: parsed)
    monkeypatch.setattr(
        lifecycle_module.broker_repository,
        "get_broker",
        lambda *_a: SimpleNamespace(status="disconnected"),
    )

    lifecycle_calls = []
    service_calls = []
    capability_calls = []

    class FakeLifecycleService:
        def __init__(self, _session):
            lifecycle_calls.append("init")

    class FakeServiceService:
        def __init__(self, _session):
            service_calls.append("init")

    class FakeCapabilityService:
        def __init__(self, _session):
            capability_calls.append("init")

    monkeypatch.setattr(lifecycle_module, "LifecycleMessageService", FakeLifecycleService)
    monkeypatch.setattr(lifecycle_module, "ServiceService", FakeServiceService)
    monkeypatch.setattr(lifecycle_module, "CapabilityService", FakeCapabilityService)

    @contextmanager
    def session_factory():
        yield None

    service = LifecycleIngestService(session_factory)

    service.handle_lifecycle_message({}, {}, broker_id=1)

    assert lifecycle_calls == []
    assert service_calls == []
    assert capability_calls == []


def test_handle_lifecycle_message_skips_when_broker_missing(monkeypatch):
    parsed = SimpleNamespace()
    monkeypatch.setattr(lifecycle_module, "parse_broker_message", lambda *_a: parsed)
    monkeypatch.setattr(
        lifecycle_module.broker_repository,
        "get_broker",
        lambda *_a: None,
    )

    lifecycle_calls = []

    class FakeLifecycleService:
        def __init__(self, _session):
            lifecycle_calls.append("init")

    monkeypatch.setattr(lifecycle_module, "LifecycleMessageService", FakeLifecycleService)

    @contextmanager
    def session_factory():
        yield None

    service = LifecycleIngestService(session_factory)

    service.handle_lifecycle_message({}, {}, broker_id=1)

    assert lifecycle_calls == []


def test_list_messages(monkeypatch):
    service = LifecycleMessageService(session=None)
    monkeypatch.setattr(
        lifecycle_module.lifecycle_repository,
        "list_lifecycle_messages",
        lambda *_a: ["msg"],
    )

    assert service.list_messages(1, 0, 10) == ["msg"]


def test_duplicate_lifecycle_ingest_refreshes_capability_schema(monkeypatch):
    engine = create_engine("sqlite://")
    Service.__table__.create(engine)
    Capability.__table__.create(engine)
    LifecycleMessage.__table__.create(engine)
    first_created_at = datetime(2026, 7, 10, 12, tzinfo=UTC)

    def parsed_message(
        message_id: str,
        created_at: datetime,
        endpoints_schema: dict,
    ) -> ParsedBrokerMessage:
        parsed = ParsedBrokerMessage(
            message_id=message_id,
            broker_id=1,
            created_at=created_at,
            hierarchy=Hierarchy(
                organization="org",
                facility="facility",
                system="system",
                subsystem="subsystem",
                service="service",
            ),
        )
        parsed.sdk_capability_name = "example-capability"
        parsed.endpoint_names = ", ".join(endpoints_schema["endpoints"])
        parsed.endpoints_schema = endpoints_schema
        return parsed

    messages = iter(
        [
            parsed_message(
                "message-1",
                first_created_at,
                {"endpoints": {"first": {}}},
            ),
            parsed_message(
                "message-2",
                first_created_at + timedelta(minutes=5),
                {
                    "endpoints": {"second": {}},
                    "components": {"schemas": {"EventPayload": {"type": "object"}}},
                },
            ),
        ]
    )
    monkeypatch.setattr(lifecycle_module, "parse_broker_message", lambda *_args: next(messages))
    monkeypatch.setattr(
        lifecycle_module.broker_repository,
        "get_broker",
        lambda *_args: SimpleNamespace(status="connected"),
    )

    ingest_service = LifecycleIngestService(lambda: Session(engine))
    ingest_service.handle_lifecycle_message({}, {}, broker_id=1)
    ingest_service.handle_lifecycle_message({}, {}, broker_id=1)

    with Session(engine) as session:
        lifecycle_rows = session.exec(select(LifecycleMessage)).all()
        capability = session.exec(select(Capability)).one()

    assert len(lifecycle_rows) == 1
    assert lifecycle_rows[0].message_id == "message-2"
    assert capability.endpoints_schema == {
        "endpoints": {"second": {}},
        "components": {"schemas": {"EventPayload": {"type": "object"}}},
    }
    assert capability.last_lifecycle_message.replace(tzinfo=UTC) == (
        first_created_at + timedelta(minutes=5)
    )
    engine.dispose()


@pytest.mark.parametrize(
    ("root_schema", "schemas"),
    [
        (
            "Node",
            {
                "Node": {
                    "type": "object",
                    "properties": {"next": {"$ref": "#/components/schemas/Node"}},
                }
            },
        ),
        (
            "A",
            {
                "A": {
                    "type": "object",
                    "properties": {"b": {"$ref": "#/components/schemas/B"}},
                },
                "B": {
                    "type": "object",
                    "properties": {"a": {"$ref": "#/components/schemas/A"}},
                },
            },
        ),
    ],
    ids=["direct-recursion", "indirect-recursion"],
)
def test_lifecycle_ingest_persists_recursive_schemas_as_json(
    monkeypatch,
    root_schema,
    schemas,
):
    engine = create_engine("sqlite://")
    Service.__table__.create(engine)
    Capability.__table__.create(engine)
    LifecycleMessage.__table__.create(engine)
    monkeypatch.setattr(
        lifecycle_module.broker_repository,
        "get_broker",
        lambda *_args: SimpleNamespace(status="connected"),
    )
    headers = SimpleNamespace(
        source="org.facility.system.subsystem.recursive-service",
        created_at=datetime(2026, 9, 21, tzinfo=UTC),
        message_id=f"recursive-{root_schema}",
    )
    payload = {
        "schema": {
            "capabilities": {
                "BaseCapability": {},
                "RecursiveCapability": {
                    "endpoints": {
                        "recursive": {
                            "publish": {
                                "message": {
                                    "payload": {"$ref": f"#/components/schemas/{root_schema}"}
                                }
                            }
                        }
                    }
                },
            },
            "components": {"schemas": schemas},
        }
    }

    LifecycleIngestService(lambda: Session(engine)).handle_lifecycle_message(
        headers,
        payload,
        broker_id=1,
    )

    with Session(engine) as session:
        persisted = session.exec(select(Capability)).one().endpoints_schema

    assert persisted is not None
    assert persisted["endpoints"]["recursive"]["publish"]["message"]["payload"] == {
        "$ref": f"#/components/schemas/{root_schema}"
    }
    assert persisted["components"]["schemas"] == schemas
    json.dumps(persisted)
    engine.dispose()


def test_lifecycle_ingest_scopes_same_capability_name_to_service(monkeypatch):
    engine = create_engine("sqlite://")
    Service.__table__.create(engine)
    Capability.__table__.create(engine)
    LifecycleMessage.__table__.create(engine)
    first_published_at = datetime(2026, 8, 24, 12, tzinfo=UTC)

    def parsed_message(
        *,
        message_id: str,
        broker_id: int,
        service_name: str,
        created_at: datetime,
        endpoint_name: str,
    ) -> ParsedBrokerMessage:
        parsed = ParsedBrokerMessage(
            message_id=message_id,
            broker_id=broker_id,
            created_at=created_at,
            hierarchy=Hierarchy(
                organization="org",
                facility="facility",
                system="system",
                subsystem="subsystem",
                service=service_name,
            ),
        )
        parsed.sdk_capability_name = "shared-capability"
        parsed.endpoint_names = endpoint_name
        parsed.endpoints_schema = {"endpoints": {endpoint_name: {}}}
        return parsed

    messages = iter(
        [
            parsed_message(
                message_id="service-a-1",
                broker_id=1,
                service_name="service-a",
                created_at=first_published_at,
                endpoint_name="service-a-original",
            ),
            parsed_message(
                message_id="service-b-1",
                broker_id=2,
                service_name="service-b",
                created_at=first_published_at + timedelta(minutes=1),
                endpoint_name="service-b-original",
            ),
            parsed_message(
                message_id="service-a-2",
                broker_id=3,
                service_name="service-a",
                created_at=first_published_at + timedelta(minutes=2),
                endpoint_name="service-a-updated",
            ),
        ]
    )
    monkeypatch.setattr(lifecycle_module, "parse_broker_message", lambda *_args: next(messages))
    monkeypatch.setattr(
        lifecycle_module.broker_repository,
        "get_broker",
        lambda *_args: SimpleNamespace(status="connected"),
    )

    ingest_service = LifecycleIngestService(lambda: Session(engine))
    ingest_service.handle_lifecycle_message({}, {}, broker_id=1)
    ingest_service.handle_lifecycle_message({}, {}, broker_id=2)

    with Session(engine) as session:
        service_b = session.exec(select(Service).where(Service.name == "service-b")).one()
        service_b_capability = session.exec(
            select(Capability).where(Capability.service_id == service_b.id)
        ).one()
        service_b_snapshot = (
            service_b_capability.id,
            service_b_capability.broker_id,
            service_b_capability.last_lifecycle_message,
            service_b_capability.endpoints_schema,
        )

    ingest_service.handle_lifecycle_message({}, {}, broker_id=3)

    with Session(engine) as session:
        services = session.exec(select(Service)).all()
        capabilities = session.exec(select(Capability)).all()
        capabilities_by_service = {
            session.get(Service, capability.service_id).name: capability
            for capability in capabilities
        }

    assert len(services) == 2
    assert len(capabilities) == 2
    assert set(capabilities_by_service) == {"service-a", "service-b"}
    assert capabilities_by_service["service-a"].broker_id == 3
    assert capabilities_by_service["service-a"].endpoints_schema == {
        "endpoints": {"service-a-updated": {}},
    }
    preserved_service_b = capabilities_by_service["service-b"]
    assert (
        preserved_service_b.id,
        preserved_service_b.broker_id,
        preserved_service_b.last_lifecycle_message,
        preserved_service_b.endpoints_schema,
    ) == service_b_snapshot
    engine.dispose()


def _create_lifecycle_health_engine():
    engine = create_engine("sqlite://")
    Service.__table__.create(engine)
    Capability.__table__.create(engine)
    LifecycleMessage.__table__.create(engine)
    return engine


def _lifecycle_health_headers(message_id: str, service: str = "service"):
    return SimpleNamespace(
        source=f"org.facility.system.subsystem.{service}",
        created_at=datetime(2026, 9, 26, 12, tzinfo=UTC),
        message_id=message_id,
    )


def _lifecycle_health_payload(endpoint_name: str, *, valid: bool = True):
    return {
        "schema": {
            "capabilities": {
                "BaseCapability": {},
                "HealthCapability": {
                    "endpoints": {endpoint_name: {}} if valid else [],
                },
            }
        }
    }


def test_attributable_parse_failure_records_and_success_clears_health(monkeypatch):
    engine = _create_lifecycle_health_engine()
    monkeypatch.setattr(
        lifecycle_module.broker_repository,
        "get_broker",
        lambda *_args: SimpleNamespace(status="connected"),
    )
    ingest = LifecycleIngestService(lambda: Session(engine))
    ingest.handle_lifecycle_message(
        _lifecycle_health_headers("successful"),
        _lifecycle_health_payload("preserved"),
        broker_id=1,
    )
    ingest.handle_lifecycle_message(
        _lifecycle_health_headers("other-successful", "other-service"),
        _lifecycle_health_payload("other-preserved"),
        broker_id=1,
    )

    with pytest.raises(TypeError, match="endpoints must be an object"):
        ingest.handle_lifecycle_message(
            _lifecycle_health_headers("rejected"),
            _lifecycle_health_payload("ignored", valid=False),
            broker_id=1,
        )

    with Session(engine) as session:
        service = session.exec(select(Service).where(Service.name == "service")).one()
        other_service = session.exec(select(Service).where(Service.name == "other-service")).one()
        capability = session.exec(
            select(Capability).where(Capability.service_id == service.id)
        ).one()
        other_capability = session.exec(
            select(Capability).where(Capability.service_id == other_service.id)
        ).one()
        lifecycle = session.exec(
            select(LifecycleMessage).where(LifecycleMessage.service == "service")
        ).one()
        assert capability.lifecycle_error == lifecycle_module.LIFECYCLE_PARSING_ERROR
        assert capability.lifecycle_error_at is not None
        assert capability.endpoints_schema == {"endpoints": {"preserved": {}}}
        assert lifecycle.message_id == "rejected"
        assert lifecycle.endpoint_names == "preserved"
        assert other_capability.lifecycle_error is None

    ingest.handle_lifecycle_message(
        _lifecycle_health_headers("recovered"),
        _lifecycle_health_payload("recovered"),
        broker_id=1,
    )

    with Session(engine) as session:
        service = session.exec(select(Service).where(Service.name == "service")).one()
        recovered = session.exec(
            select(Capability).where(Capability.service_id == service.id)
        ).one()
        assert recovered.lifecycle_error is None
        assert recovered.lifecycle_error_at is None

    engine.dispose()


def test_persistence_failure_preserves_last_successful_metadata(monkeypatch):
    engine = _create_lifecycle_health_engine()
    monkeypatch.setattr(
        lifecycle_module.broker_repository,
        "get_broker",
        lambda *_args: SimpleNamespace(status="connected"),
    )
    ingest = LifecycleIngestService(lambda: Session(engine))
    ingest.handle_lifecycle_message(
        _lifecycle_health_headers("successful"),
        _lifecycle_health_payload("preserved"),
        broker_id=1,
    )

    def fail_capability_upsert(*_args, **_kwargs):
        raise RuntimeError("database detail that must remain server-only")

    monkeypatch.setattr(
        lifecycle_module.CapabilityService,
        "upsert_from_lifecycle",
        fail_capability_upsert,
    )

    with pytest.raises(RuntimeError, match="database detail"):
        ingest.handle_lifecycle_message(
            _lifecycle_health_headers("failed-save"),
            _lifecycle_health_payload("must-not-replace"),
            broker_id=1,
        )

    with Session(engine) as session:
        capability = session.exec(select(Capability)).one()
        lifecycle = session.exec(select(LifecycleMessage)).one()
        assert capability.lifecycle_error == lifecycle_module.LIFECYCLE_PERSISTENCE_ERROR
        assert capability.endpoints_schema == {"endpoints": {"preserved": {}}}
        assert lifecycle.message_id == "failed-save"
        assert lifecycle.endpoint_names == "preserved"

    engine.dispose()
