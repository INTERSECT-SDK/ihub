import asyncio
import json

from starlette.requests import Request

from ihub_server.api.v1.endpoints.messages import subscribe_to_messages
from ihub_server.services.lifecycle_message_stream import LifecycleMessageStreamManager


def _request(manager: LifecycleMessageStreamManager) -> Request:
    app = type("App", (), {"state": type("State", (), {})()})()
    app.state.lifecycle_message_stream = manager
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/v1/messages/stream",
            "headers": [],
            "app": app,
            "client": ("127.0.0.1", 1234),
        }
    )


def test_stream_has_sse_contract_without_a_broker():
    async def scenario():
        manager = LifecycleMessageStreamManager()
        await manager.start()
        response = await subscribe_to_messages(_request(manager))

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.ping_interval == 15

        item_task = asyncio.create_task(anext(response.body_iterator))
        await asyncio.sleep(0)
        assert manager.subscriber_count == 1
        item_task.cancel()
        await asyncio.gather(item_task, return_exceptions=True)
        assert manager.subscriber_count == 0

    asyncio.run(scenario())


def test_stream_frames_valid_json_data_from_shared_manager():
    async def scenario():
        manager = LifecycleMessageStreamManager()
        await manager.start()
        envelope = json.dumps({"message_id": "one", "payload": {"status": "up"}})
        manager.publish(envelope)
        await asyncio.sleep(0)

        response = await subscribe_to_messages(_request(manager))
        event = await anext(response.body_iterator)

        assert json.loads(event.data) == json.loads(envelope)
        assert event.encode() == f"data: {envelope}\r\n\r\n".encode()
        await response.body_iterator.aclose()
        assert manager.subscriber_count == 0

    asyncio.run(scenario())
