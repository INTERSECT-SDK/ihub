from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from ihub_server.models import CapabilityCreate, CapabilityUpdate
from ihub_server.models.service import Hierarchy
from ihub_server.services import capabilities as capabilities_module
from ihub_server.services.capabilities import CapabilityService
from ihub_server.services.errors import NotFoundError
from ihub_server.utils.lifecycle_message import ParsedBrokerMessage


def _make_parsed_message() -> ParsedBrokerMessage:
    message = ParsedBrokerMessage(
        message_id="id",
        broker_id=1,
        created_at=datetime.now(UTC),
        hierarchy=Hierarchy(
            organization="org",
            facility="facility",
            system="system",
            subsystem="subsystem",
            service="service",
        ),
    )
    message.sdk_capability_name = "capability"
    message.endpoints_schema = {"channels": {}}
    return message


def test_get_capability_missing(monkeypatch):
    service = CapabilityService(session=None)
    monkeypatch.setattr(
        capabilities_module.capability_repository, "get_capability_with_health", lambda *_a: None
    )

    with pytest.raises(NotFoundError):
        service.get_capability(1)


def test_update_capability_missing(monkeypatch):
    service = CapabilityService(session=None)
    monkeypatch.setattr(
        capabilities_module.capability_repository, "get_capability", lambda *_a: None
    )

    with pytest.raises(NotFoundError):
        service.update_capability(1, CapabilityUpdate())


def test_upsert_from_lifecycle_no_service_id():
    service = CapabilityService(session=None)

    result = service.upsert_from_lifecycle(_make_parsed_message(), SimpleNamespace(id=None))

    assert result is None


def test_upsert_from_lifecycle_delegates_service_scoped_values(monkeypatch):
    service = CapabilityService(session=None)
    parsed_message = _make_parsed_message()

    captured = {}

    def fake_upsert(_session, capability):
        captured["capability"] = capability
        return "upserted"

    monkeypatch.setattr(
        capabilities_module.capability_repository,
        "upsert_capability",
        fake_upsert,
    )

    service_record = SimpleNamespace(id=1, broker_id=2)
    result = service.upsert_from_lifecycle(parsed_message, service_record)

    assert result == "upserted"
    assert isinstance(captured["capability"], CapabilityCreate)
    assert captured["capability"].name == parsed_message.sdk_capability_name
    assert captured["capability"].service_id == 1
    assert captured["capability"].broker_id == 2
    assert captured["capability"].last_lifecycle_message == parsed_message.created_at
    assert captured["capability"].endpoints_schema == parsed_message.endpoints_schema


def test_list_capabilities(monkeypatch):
    service = CapabilityService(session=None)
    monkeypatch.setattr(
        capabilities_module.capability_repository,
        "list_capabilities",
        lambda *_a: ["cap"],
    )

    assert service.list_capabilities(0, 10) == ["cap"]


def test_list_capabilities_for_service(monkeypatch):
    service = CapabilityService(session=None)
    monkeypatch.setattr(
        capabilities_module.capability_repository,
        "list_capabilities_for_service",
        lambda *_a: ["cap"],
    )

    assert service.list_capabilities_for_service(1, 0, 10) == ["cap"]


def test_create_capability(monkeypatch):
    service = CapabilityService(session=None)
    cap = CapabilityCreate(name="cap", service_id=1, broker_id=1, endpoints_schema={})
    monkeypatch.setattr(
        capabilities_module.capability_repository,
        "create_capability",
        lambda *_a: "created",
    )

    assert service.create_capability(cap) == "created"


def test_update_capability_success(monkeypatch):
    service = CapabilityService(session=None)
    cap = SimpleNamespace(id=1)
    monkeypatch.setattr(
        capabilities_module.capability_repository,
        "get_capability",
        lambda *_a: cap,
    )
    monkeypatch.setattr(
        capabilities_module.capability_repository,
        "update_capability",
        lambda *_a: "updated",
    )

    assert service.update_capability(1, CapabilityUpdate()) == "updated"
