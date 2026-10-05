import base64
import asyncio
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from ihub_server.api.v1.endpoints.chat import ChatSocketUserMessage, _get_websocket_principal


def _attachment(name: str = "notes.txt", content: bytes = b"hello") -> dict[str, object]:
    return {
        "name": name,
        "mimeType": "text/plain",
        "size": len(content),
        "data": base64.b64encode(content).decode("ascii"),
    }


def test_chat_websocket_rejects_stored_guest_session():
    class RedisJson:
        async def get(self, _session_id):
            return {
                "role": "guest",
                "subject_id": "legacy-guest",
                "email": "legacy@example.com",
            }

    websocket = SimpleNamespace(
        cookies={"IHUB_SESSION": "legacy-session"},
        app=SimpleNamespace(state=SimpleNamespace(redis=SimpleNamespace(json=lambda: RedisJson()))),
    )

    assert asyncio.run(_get_websocket_principal(websocket)) is None


def test_chat_websocket_closes_stored_guest_session_with_4401(client, app, monkeypatch):
    class RedisJson:
        async def get(self, _session_id):
            return {
                "role": "guest",
                "subject_id": "legacy-guest",
                "email": "legacy@example.com",
            }

    redis = SimpleNamespace(json=lambda: RedisJson(), ping=lambda: False)
    monkeypatch.setattr(app.state, "redis", redis)
    client.cookies.set("IHUB_SESSION", "legacy-session")

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/api/v1/chat/ws/4b975707-f357-40bc-a0aa-cb012ed780c9"):
            pass

    assert exc_info.value.code == 4401


def test_chat_socket_message_accepts_attachment_only_turn():
    message = ChatSocketUserMessage.model_validate(
        {
            "type": "user.message",
            "conversationId": "conversation-1",
            "message": "",
            "attachments": [_attachment()],
        }
    )

    assert message.attachments[0].name == "notes.txt"
    assert message.attachments[0].size == 5


def test_chat_socket_message_rejects_invalid_attachment_data():
    attachment = _attachment()
    attachment["data"] = "not base64"

    with pytest.raises(ValidationError, match="valid base64"):
        ChatSocketUserMessage.model_validate(
            {
                "type": "user.message",
                "conversationId": "conversation-1",
                "message": "Read this",
                "attachments": [attachment],
            }
        )


def test_chat_socket_message_rejects_too_many_attachments():
    with pytest.raises(ValidationError, match="at most 5 attachments"):
        ChatSocketUserMessage.model_validate(
            {
                "type": "user.message",
                "conversationId": "conversation-1",
                "message": "Read these",
                "attachments": [_attachment(f"notes-{index}.txt") for index in range(6)],
            }
        )


def test_chat_socket_message_rejects_path_like_filename():
    with pytest.raises(ValidationError, match="plain filename"):
        ChatSocketUserMessage.model_validate(
            {
                "type": "user.message",
                "conversationId": "conversation-1",
                "message": "Read this",
                "attachments": [_attachment("../notes.txt")],
            }
        )
