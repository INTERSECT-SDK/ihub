import asyncio
import json
from collections import deque
from datetime import UTC, datetime
from types import SimpleNamespace

from ihub_server.core import dynamic_intersect_client as client_module
from ihub_server.core.dynamic_intersect_client import DynamicCoreServiceIntersectClient
from ihub_server.services.lifecycle_message_stream import LifecycleMessageStreamManager
from ihub_server.utils.lifecycle_message import parse_broker_message
from pika.exceptions import ConnectionWrongStateError


def _make_client(lifecycle_handler=None, ingest_enabled=False, lifecycle_publisher=None):
    client = DynamicCoreServiceIntersectClient.__new__(DynamicCoreServiceIntersectClient)
    client.broker_id = 1
    client.save_message = ingest_enabled
    client._lifecycle_ingest_enabled = ingest_enabled
    client._buffer_lifecycle_until_ingest_enabled = (
        lifecycle_handler is not None and not ingest_enabled
    )
    client._pending_lifecycle_messages = deque()
    client._closed = False
    client._lifecycle_handler = lifecycle_handler
    client._lifecycle_publisher = lifecycle_publisher
    return client


def test_closed_client_ignores_lifecycle_callback():
    calls = []
    client = _make_client(lambda *_args: calls.append("saved"), ingest_enabled=True)
    client._closed = True

    client._handle_message(b"not json", "not-json", {})

    assert calls == []


def test_lifecycle_message_buffered_while_ingest_disabled(monkeypatch):
    calls = []
    client = _make_client(lambda *_args: calls.append("saved"))
    monkeypatch.setattr(
        client_module,
        "validate_lifecycle_message_headers",
        lambda headers: SimpleNamespace(message_id=headers["message_id"]),
    )

    client._handle_message(
        b'{"seq": 1}',
        "application/json",
        {"message_id": "first"},
    )

    assert calls == []
    assert len(client._pending_lifecycle_messages) == 1


def test_enable_lifecycle_ingest_replays_buffer_once_in_order(monkeypatch):
    calls = []
    client = _make_client(
        lambda headers, payload, broker_id: calls.append(
            (headers.message_id, payload["seq"], broker_id)
        )
    )
    monkeypatch.setattr(
        client_module,
        "validate_lifecycle_message_headers",
        lambda headers: SimpleNamespace(message_id=headers["message_id"]),
    )

    client._handle_message(
        b'{"seq": 1}',
        "application/json",
        {"message_id": "first"},
    )
    client._handle_message(
        b'{"seq": 2}',
        "application/json",
        {"message_id": "second"},
    )

    client.enable_lifecycle_ingest()
    client.enable_lifecycle_ingest()

    assert calls == [("first", 1, 1), ("second", 2, 1)]
    assert list(client._pending_lifecycle_messages) == []


def test_lifecycle_message_after_enable_calls_handler_immediately(monkeypatch):
    calls = []
    client = _make_client(
        lambda headers, payload, broker_id: calls.append(
            (headers.message_id, payload["seq"], broker_id)
        )
    )
    monkeypatch.setattr(
        client_module,
        "validate_lifecycle_message_headers",
        lambda headers: SimpleNamespace(message_id=headers["message_id"]),
    )

    client.enable_lifecycle_ingest()
    client._handle_message(
        b'{"seq": 1}',
        "application/json",
        {"message_id": "first"},
    )

    assert calls == [("first", 1, 1)]
    assert list(client._pending_lifecycle_messages) == []


def test_failed_live_advertisement_does_not_block_the_next_message(monkeypatch, caplog):
    calls = []

    def handler(headers, payload, broker_id):
        calls.append((headers.message_id, broker_id))
        if headers.message_id == "failed-message":
            raise RuntimeError("persistence failed")

    client = _make_client(handler, ingest_enabled=True)
    monkeypatch.setattr(
        client_module,
        "validate_lifecycle_message_headers",
        lambda headers: SimpleNamespace(
            message_id=headers["message_id"],
            source=headers["source"],
        ),
    )

    with caplog.at_level("ERROR"):
        client._handle_message(
            b'{"private_payload": "do-not-log"}',
            "application/json",
            {
                "message_id": "failed-message",
                "source": "org.facility.system.subsystem.failed-service",
            },
        )
        client._handle_message(
            b'{"seq": 2}',
            "application/json",
            {
                "message_id": "successful-message",
                "source": "org.facility.system.subsystem.good-service",
            },
        )

    assert calls == [("failed-message", 1), ("successful-message", 1)]
    assert "broker_id=1" in caplog.text
    assert "message_id=failed-message" in caplog.text
    assert "source=org.facility.system.subsystem.failed-service" in caplog.text
    assert "do-not-log" not in caplog.text


def test_failed_buffered_advertisement_does_not_abort_replay(monkeypatch):
    calls = []

    def handler(headers, payload, broker_id):
        calls.append((headers.message_id, payload["seq"], broker_id))
        if headers.message_id == "failed-message":
            raise RuntimeError("persistence failed")

    client = _make_client(handler)
    monkeypatch.setattr(
        client_module,
        "validate_lifecycle_message_headers",
        lambda headers: SimpleNamespace(
            message_id=headers["message_id"],
            source="org.facility.system.subsystem.service",
        ),
    )
    client._handle_message(
        b'{"seq": 1}',
        "application/json",
        {"message_id": "failed-message"},
    )
    client._handle_message(
        b'{"seq": 2}',
        "application/json",
        {"message_id": "successful-message"},
    )

    client.enable_lifecycle_ingest()

    assert calls == [
        ("failed-message", 1, 1),
        ("successful-message", 2, 1),
    ]
    assert list(client._pending_lifecycle_messages) == []


def test_recursive_schema_is_delivered_and_streamed_without_expansion(monkeypatch):
    delivered = []
    published = []
    client = _make_client(
        lambda _headers, payload, _broker_id: delivered.append(payload),
        ingest_enabled=True,
        lifecycle_publisher=published.append,
    )
    monkeypatch.setattr(
        client_module,
        "validate_lifecycle_message_headers",
        lambda _headers: SimpleNamespace(
            message_id="recursive-message",
            source="org.facility.system.subsystem.service",
        ),
    )
    message = {
        "schema": {
            "components": {
                "schemas": {
                    "Node": {
                        "type": "object",
                        "properties": {"next": {"$ref": "#/components/schemas/Node"}},
                    }
                }
            }
        }
    }

    client._handle_message(
        json.dumps(message).encode(),
        "application/json",
        {"message_id": "recursive-message"},
    )

    assert delivered == [message]
    streamed = json.loads(published[0])
    assert streamed["payload"] == message


def test_unsupported_schema_shape_is_logged_as_rejected_without_payload(monkeypatch, caplog):
    client = _make_client(parse_broker_message, ingest_enabled=True)
    monkeypatch.setattr(
        client_module,
        "validate_lifecycle_message_headers",
        lambda headers: SimpleNamespace(
            message_id=headers["message_id"],
            source=headers["source"],
            created_at=datetime(2026, 9, 21, tzinfo=UTC),
        ),
    )

    with caplog.at_level("ERROR"):
        client._handle_message(
            b'{"schema": {"capabilities": ["private-payload"]}}',
            "application/json",
            {
                "message_id": "invalid-message",
                "source": "org.facility.system.subsystem.invalid-service",
            },
        )

    assert "Rejected lifecycle advertisement" in caplog.text
    assert "broker_id=1" in caplog.text
    assert "message_id=invalid-message" in caplog.text
    assert "source=org.facility.system.subsystem.invalid-service" in caplog.text
    assert "private-payload" not in caplog.text


def test_valid_message_publishes_after_ingest_and_copies_headers(monkeypatch):
    events = []
    raw_headers = {"message_id": "first"}

    def ingest(headers, payload, broker_id):
        events.append(("ingest", headers.message_id, payload["seq"], broker_id))

    def publish(message):
        events.append(("publish", json.loads(message)))

    client = _make_client(ingest, ingest_enabled=True, lifecycle_publisher=publish)
    monkeypatch.setattr(
        client_module,
        "validate_lifecycle_message_headers",
        lambda headers: SimpleNamespace(message_id=headers["message_id"]),
    )

    client._handle_message(b'{"seq": 1}', "application/json", raw_headers)

    assert events == [
        ("ingest", "first", 1, 1),
        ("publish", {"message_id": "first", "payload": {"seq": 1}}),
    ]
    assert raw_headers == {"message_id": "first"}


def test_ingest_failure_still_publishes_refresh_notification(monkeypatch):
    published = []

    def failed_ingest(*_args):
        raise RuntimeError("recorded lifecycle health error")

    client = _make_client(
        failed_ingest,
        ingest_enabled=True,
        lifecycle_publisher=published.append,
    )
    monkeypatch.setattr(
        client_module,
        "validate_lifecycle_message_headers",
        lambda headers: SimpleNamespace(
            message_id=headers["message_id"],
            source="org.facility.system.subsystem.service",
        ),
    )

    client._handle_message(
        b'{"schema": {}}',
        "application/json",
        {"message_id": "failed"},
    )

    assert json.loads(published[0]) == {
        "message_id": "failed",
        "payload": {"schema": {}},
    }


def test_multiple_dynamic_clients_publish_to_the_shared_stream(monkeypatch):
    async def scenario():
        manager = LifecycleMessageStreamManager()
        await manager.start()
        monkeypatch.setattr(
            client_module,
            "validate_lifecycle_message_headers",
            lambda headers: SimpleNamespace(message_id=headers["message_id"]),
        )
        clients = [
            _make_client(
                lambda *_args: None,
                ingest_enabled=True,
                lifecycle_publisher=manager.publish,
            )
            for _index in range(2)
        ]

        async with manager.subscribe() as queue:
            for index, client in enumerate(clients):
                client._handle_message(
                    json.dumps({"seq": index}).encode(),
                    "application/json",
                    {"message_id": str(index)},
                )
            await asyncio.sleep(0)

            assert [json.loads((await queue.get()))["message_id"] for _ in clients] == [
                "0",
                "1",
            ]

    asyncio.run(scenario())


def test_buffered_startup_message_publishes_once_after_ingest(monkeypatch):
    events = []
    client = _make_client(
        lambda headers, *_args: events.append(f"ingest:{headers.message_id}"),
        lifecycle_publisher=lambda message: events.append(
            f"publish:{json.loads(message)['message_id']}"
        ),
    )
    monkeypatch.setattr(
        client_module,
        "validate_lifecycle_message_headers",
        lambda headers: SimpleNamespace(message_id=headers["message_id"]),
    )

    client._handle_message(b"{}", "application/json", {"message_id": "startup"})
    client.enable_lifecycle_ingest()
    client.enable_lifecycle_ingest()

    assert events == ["ingest:startup", "publish:startup"]


def test_malformed_transport_messages_do_not_publish(monkeypatch):
    published = []
    client = _make_client(
        lambda *_args: None,
        ingest_enabled=True,
        lifecycle_publisher=published.append,
    )
    client._handle_message(b"{}", "text/plain", {})
    client._handle_message(b"{}", "application/json", {})
    monkeypatch.setattr(
        client_module,
        "validate_lifecycle_message_headers",
        lambda _headers: SimpleNamespace(message_id="bad-json"),
    )
    client._handle_message(b"not-json", "application/json", {})

    assert published == []


def test_disable_lifecycle_ingest_clears_buffer_without_replay(monkeypatch):
    calls = []
    client = _make_client(lambda *_args: calls.append("saved"))
    monkeypatch.setattr(
        client_module,
        "validate_lifecycle_message_headers",
        lambda headers: SimpleNamespace(message_id=headers["message_id"]),
    )

    client._handle_message(
        b'{"seq": 1}',
        "application/json",
        {"message_id": "first"},
    )
    client.disable_lifecycle_ingest()
    client.enable_lifecycle_ingest()

    assert calls == []
    assert list(client._pending_lifecycle_messages) == []


def test_terminate_closes_and_disables_lifecycle_before_disconnect():
    client = _make_client(ingest_enabled=True)
    client._pending_lifecycle_messages.append(("headers", {"seq": 1}))
    events = []

    class FakeControlPlaneManager:
        def disconnect(self):
            events.append((client._closed, client._lifecycle_ingest_enabled))

    client.control_plane_manager = FakeControlPlaneManager()

    client.terminate()

    assert client._closed is True
    assert client._lifecycle_ingest_enabled is False
    assert client.save_message is False
    assert client._buffer_lifecycle_until_ingest_enabled is False
    assert list(client._pending_lifecycle_messages) == []
    assert events == [(True, False)]


def test_terminate_tolerates_connection_already_closed_by_broker():
    client = _make_client(ingest_enabled=True)

    class ClosedControlPlaneManager:
        def disconnect(self):
            raise ConnectionWrongStateError("connection state=CLOSED")

    client.control_plane_manager = ClosedControlPlaneManager()

    client.terminate()

    assert client._closed is True
