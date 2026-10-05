import pytest

from ihub_server.models.orchestrator_event import OrchestratorEventCreate
from ihub_server.services import orchestrator_events as events_module
from ihub_server.services.errors import NotFoundError
from ihub_server.services.orchestrator_events import OrchestratorEventService


def test_create_event(monkeypatch):
    service = OrchestratorEventService(session=None)
    monkeypatch.setattr(events_module.event_repository, "create_event", lambda *_a: "created")

    assert (
        service.create_event(
            OrchestratorEventCreate(
                campaign_id="c",
                step_id="step",
                event_type="type",
                fields_to_populate=[],
            )
        )
        == "created"
    )


def test_get_event_missing(monkeypatch):
    service = OrchestratorEventService(session=None)
    monkeypatch.setattr(events_module.event_repository, "get_event", lambda *_a: None)

    with pytest.raises(NotFoundError):
        service.get_event(1)


def test_list_events(monkeypatch):
    service = OrchestratorEventService(session=None)
    monkeypatch.setattr(events_module.event_repository, "list_events", lambda *_a: ["event"])

    assert service.list_events("campaign") == ["event"]


def test_get_event_success(monkeypatch):
    service = OrchestratorEventService(session=None)
    expected = object()
    monkeypatch.setattr(events_module.event_repository, "get_event", lambda *_a: expected)

    assert service.get_event(1) == expected
