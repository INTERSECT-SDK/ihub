from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from ihub_server.models import ServiceCreate, ServiceUpdate
from ihub_server.models.service import Hierarchy
from ihub_server.services import services as services_module
from ihub_server.services.errors import NotFoundError
from ihub_server.services.services import ServiceService
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


def test_get_service_missing(monkeypatch):
    service = ServiceService(session=None)
    monkeypatch.setattr(services_module.service_repository, "get_service", lambda *_a: None)

    with pytest.raises(NotFoundError):
        service.get_service(1)


def test_update_service_missing(monkeypatch):
    service = ServiceService(session=None)
    monkeypatch.setattr(services_module.service_repository, "get_service", lambda *_a: None)

    with pytest.raises(NotFoundError):
        service.update_service(1, ServiceUpdate())


def test_upsert_updates_existing(monkeypatch):
    service = ServiceService(session=None)
    parsed_message = _make_parsed_message()
    existing = SimpleNamespace(id=1)

    monkeypatch.setattr(service, "get_service_by_name", lambda *_a: existing)

    captured = {}

    def fake_update(_session, service_obj, updates):
        captured["service"] = service_obj
        captured["updates"] = updates
        return "updated"

    monkeypatch.setattr(services_module.service_repository, "update_service", fake_update)

    result = service.upsert_from_lifecycle(parsed_message, broker_id=2)

    assert result == "updated"
    assert captured["service"] == existing


def test_upsert_creates_new(monkeypatch):
    service = ServiceService(session=None)
    parsed_message = _make_parsed_message()
    monkeypatch.setattr(service, "get_service_by_name", lambda *_a: None)

    captured = {}

    def fake_create(_session, service_obj):
        captured["service"] = service_obj
        return "created"

    monkeypatch.setattr(services_module.service_repository, "create_service", fake_create)

    result = service.upsert_from_lifecycle(parsed_message, broker_id=2)

    assert result == "created"
    assert isinstance(captured["service"], ServiceCreate)


def test_list_services(monkeypatch):
    service = ServiceService(session=None)
    monkeypatch.setattr(services_module.service_repository, "list_services", lambda *_a: ["svc"])

    assert service.list_services(0, 10) == ["svc"]


def test_list_services_for_broker(monkeypatch):
    service = ServiceService(session=None)
    monkeypatch.setattr(
        services_module.service_repository,
        "list_services_for_broker",
        lambda *_a: ["svc"],
    )

    assert service.list_services_for_broker(1) == ["svc"]


def test_get_service_success(monkeypatch):
    service = ServiceService(session=None)
    expected = object()
    monkeypatch.setattr(services_module.service_repository, "get_service", lambda *_a: expected)

    assert service.get_service(1) == expected


def test_get_service_by_name(monkeypatch):
    service = ServiceService(session=None)
    monkeypatch.setattr(
        services_module.service_repository, "get_service_by_name", lambda *_a: "svc"
    )

    assert service.get_service_by_name("svc") == "svc"


def test_update_service_success(monkeypatch):
    service = ServiceService(session=None)
    existing = object()
    monkeypatch.setattr(services_module.service_repository, "get_service", lambda *_a: existing)
    monkeypatch.setattr(services_module.service_repository, "update_service", lambda *_a: "updated")

    assert service.update_service(1, ServiceUpdate()) == "updated"
