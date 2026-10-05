from types import SimpleNamespace

import pytest

from ihub_server.services import flowcept as flowcept_module
from ihub_server.services.errors import ConflictError
from ihub_server.services.flowcept import FlowceptService


class DummyAppState:
    pass


def test_connect_broker_conflict():
    service = FlowceptService(session=None)
    app_state = DummyAppState()
    app_state.s3m_consumer = object()

    with pytest.raises(ConflictError):
        service.connect_broker(app_state)


def test_connect_broker_success(monkeypatch):
    service = FlowceptService(session=None)
    app_state = DummyAppState()

    class FakeConsumer:
        def __init__(self, save):
            self.save = save
            self.started = False

        def start(self, daemon):
            self.started = True

    monkeypatch.setattr(flowcept_module, "AgentConsumer", FakeConsumer)

    service.connect_broker(app_state)

    assert hasattr(app_state, "s3m_consumer")
    assert app_state.s3m_consumer.started is True


def test_disconnect_broker_missing_consumer():
    service = FlowceptService(session=None)
    app_state = DummyAppState()

    with pytest.raises(ConflictError):
        service.disconnect_broker(app_state)


def test_disconnect_broker_success():
    service = FlowceptService(session=None)
    app_state = DummyAppState()

    class FakeConsumer:
        def __init__(self):
            self.stopped = False

        def stop_consumption(self):
            self.stopped = True

    app_state.s3m_consumer = FakeConsumer()

    service.disconnect_broker(app_state)

    assert not hasattr(app_state, "s3m_consumer")


def test_check_connection_missing_consumer():
    service = FlowceptService(session=None)
    app_state = DummyAppState()

    with pytest.raises(ConflictError):
        service.check_connection(app_state)


def test_check_connection_success():
    service = FlowceptService(session=None)
    app_state = DummyAppState()
    app_state.s3m_consumer = SimpleNamespace(_mq_dao=SimpleNamespace(liveness_test=lambda: True))

    assert service.check_connection(app_state) is True


def test_list_messages(monkeypatch):
    service = FlowceptService(session=None)
    monkeypatch.setattr(flowcept_module.flowcept_repository, "list_messages", lambda *_a: ["msg"])

    assert service.list_messages(0, 10) == ["msg"]


def test_list_messages_by_activity(monkeypatch):
    service = FlowceptService(session=None)
    monkeypatch.setattr(
        flowcept_module.flowcept_repository,
        "list_messages_by_activity",
        lambda *_a: ["msg"],
    )

    assert service.list_messages_by_activity("activity", 0, 10) == ["msg"]


def test_send_message(monkeypatch):
    service = FlowceptService(session=None)
    captured = {}

    class FakeFlowcept:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class FakeTask:
        def __init__(self, **kwargs):
            captured["payload"] = kwargs

        def end(self):
            captured["ended"] = True

    monkeypatch.setattr(flowcept_module, "Flowcept", FakeFlowcept)
    monkeypatch.setattr(flowcept_module, "FlowceptTask", FakeTask)

    service.send_message({"key": "value"})

    assert captured["payload"]["used"] == {"key": "value"}
    assert captured.get("ended") is True


def test_send_hmi_message(monkeypatch):
    service = FlowceptService(session=None)
    captured = {}

    class FakeFlowcept:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class FakeTask:
        def __init__(self, **kwargs):
            captured["payload"] = kwargs

        def end(self):
            captured["ended"] = True

    monkeypatch.setattr(flowcept_module, "Flowcept", FakeFlowcept)
    monkeypatch.setattr(flowcept_module, "FlowceptTask", FakeTask)

    service.send_hmi_message("activity", {"key": "value"})

    assert captured["payload"]["activity_id"] == "activity"
    assert captured.get("ended") is True
