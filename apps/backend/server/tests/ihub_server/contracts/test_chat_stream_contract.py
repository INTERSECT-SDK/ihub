"""Golden-file contracts for Chat streaming adapter events."""

import asyncio
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any
import uuid

import pytest
from a2a.helpers.proto_helpers import (
    new_data_artifact_update_event,
    new_data_message,
    new_text_artifact_update_event,
)
from a2a.types import StreamResponse

from ihub_server.services import chat as chat_module
from ihub_server.services.chat import ChatService

CONTRACT_DATA_DIR = Path(__file__).parents[2] / "data" / "contracts" / "chat-stream"
CONVERSATION_ID = "contract-conversation"
LOCAL_AGENT_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
REMOTE_SERVER_ID = 7
REMOTE_AGENT_ID = "weather-agent"
REMOTE_SENDER_ID = f"remote:{REMOTE_SERVER_ID}:{REMOTE_AGENT_ID}"
GENERATED_MESSAGE_ID = "<generated-message-id>"
GENERATED_TIMESTAMP = "<generated-timestamp>"


@pytest.fixture(autouse=True)
def clear_chat_caches() -> None:
    """Keep every contract scenario independent of process-local chat state."""
    chat_module.graph_cache.clear()
    chat_module.a2a_context_cache.clear()
    chat_module.agui_thread_cache.clear()
    yield
    chat_module.graph_cache.clear()
    chat_module.a2a_context_cache.clear()
    chat_module.agui_thread_cache.clear()


class _AgentService:
    def get_agent(self, agent_id: uuid.UUID) -> dict[str, str]:
        return {"id": str(agent_id)}


class _LocalGraph:
    def __init__(self, *, fail: bool) -> None:
        self._fail = fail

    async def astream(self, _payload: Any, stream_mode: str) -> Any:
        assert stream_mode == "values"
        existing = {"id": "upstream-user-1", "type": "human", "content": "Question"}
        if self._fail:
            yield {
                "messages": [
                    existing,
                    {"id": "upstream-assistant-error", "type": "ai", "content": "Partial"},
                ]
            }
            raise RuntimeError("local stream failed")

        tool_call = {
            "id": "upstream-assistant-tool",
            "type": "ai",
            "content": "",
            "tool_calls": [
                {
                    "id": "tool-weather-1",
                    "name": "get_weather",
                    "args": {"city": "Oak Ridge"},
                }
            ],
        }
        tool_result = {
            "id": "upstream-tool-result-1",
            "type": "tool",
            "tool_call_id": "tool-weather-1",
            "name": "get_weather",
            "content": '{"temperature":72,"unit":"F"}',
        }
        text = {
            "id": "upstream-assistant-text",
            "type": "ai",
            "content": "It is 72 F.",
        }
        yield {"messages": [existing, tool_call]}
        yield {"messages": [existing, tool_call, tool_result]}
        yield {"messages": [existing, tool_call, tool_result, text]}


class _LangGraphClient:
    def __init__(self, *, fail: bool) -> None:
        self.threads = self
        self.runs = self
        self._fail = fail

    async def get_state(self, _thread_id: str) -> dict[str, Any]:
        return {
            "values": {
                "messages": [
                    {"id": "prior-user-1", "type": "human", "content": "Earlier"},
                    {"id": "prior-assistant-1", "type": "ai", "content": "Earlier reply"},
                ]
            }
        }

    async def stream(self, **_kwargs: Any) -> Any:
        prior = [
            {"id": "prior-user-1", "type": "human", "content": "Earlier"},
            {"id": "prior-assistant-1", "type": "ai", "content": "Earlier reply"},
        ]
        current_user = {"id": "upstream-user-2", "type": "human", "content": "Weather?"}
        if self._fail:
            yield SimpleNamespace(
                event="values",
                data={
                    "messages": prior
                    + [
                        current_user,
                        {"id": "upstream-assistant-error", "type": "ai", "content": "Partial"},
                    ]
                },
            )
            raise RuntimeError("LangGraph stream failed")

        tool_snapshot = {
            "id": "upstream-assistant-2",
            "type": "ai",
            "content": "Checking",
            "tool_calls": [
                {
                    "id": "tool-weather-1",
                    "name": "get_weather",
                    "args": {"city": "Oak Ridge"},
                }
            ],
        }
        yield SimpleNamespace(
            event="values",
            data={"messages": prior + [current_user, tool_snapshot]},
        )
        yield SimpleNamespace(
            event="values",
            data={
                "messages": prior
                + [
                    current_user,
                    {**tool_snapshot, "content": "Checking now"},
                    {
                        "id": "upstream-tool-result-1",
                        "type": "tool",
                        "tool_call_id": "tool-weather-1",
                        "name": "get_weather",
                        "content": '{"temperature":72,"unit":"F"}',
                    },
                ]
            },
        )

    async def aclose(self) -> None:
        return None


class _A2AClient:
    def __init__(self, responses: list[StreamResponse], *, fail: bool) -> None:
        self._responses = responses
        self._fail = fail

    async def send_message(self, _request: Any) -> Any:
        for response in self._responses:
            yield response
        if self._fail:
            raise RuntimeError("A2A stream failed")

    async def close(self) -> None:
        return None


class _AGUIResponse:
    def __init__(self, events: list[str]) -> None:
        self._events = events

    async def __aenter__(self) -> "_AGUIResponse":
        return self

    async def __aexit__(self, *_args: Any) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    async def aiter_lines(self) -> Any:
        for event in self._events:
            yield f"data: {event}"
            yield ""


class _AGUIClient:
    def __init__(self, events: list[str]) -> None:
        self._events = events

    def stream(self, *_args: Any, **_kwargs: Any) -> _AGUIResponse:
        return _AGUIResponse(self._events)

    async def aclose(self) -> None:
        return None


class _RemoteAgentService:
    def __init__(self, protocol: str, client: Any) -> None:
        self._protocol = protocol
        self._client = client

    def get_remote_agent(self, _server_id: int) -> Any:
        return SimpleNamespace(
            protocol=self._protocol,
            assistant_id=REMOTE_AGENT_ID,
            url="https://agent.example.test/stream",
        )

    def get_discovered_remote_agent(self, _server_id: int, _agent_id: str) -> Any:
        return SimpleNamespace(protocol=self._protocol, assistant_metadata={})

    def get_async_client(self, _remote_agent: Any) -> Any:
        return self._client

    async def get_a2a_client(self, _remote_agent: Any, _discovered_agent: Any) -> Any:
        return self._client

    def get_agui_client(self, _remote_agent: Any) -> Any:
        return self._client


async def _collect_events(events: Any) -> list[dict[str, Any]]:
    return [event async for event in events]


def _normalize_generated_values(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Validate and replace only runtime-generated message IDs and timestamps."""
    normalized = deepcopy(events)
    message_ids: dict[str, str] = {}

    for event in normalized:
        message_id = event.get("messageId")
        if isinstance(message_id, str) and message_id.startswith("assistant-"):
            generated_uuid = uuid.UUID(message_id.removeprefix("assistant-"))
            assert generated_uuid.version == 4
            message_ids.setdefault(message_id, GENERATED_MESSAGE_ID)
            event["messageId"] = message_ids[message_id]

        timestamp = event.get("timestamp")
        if timestamp is not None:
            parsed_timestamp = datetime.fromisoformat(timestamp)
            assert parsed_timestamp.tzinfo is not None
            event["timestamp"] = GENERATED_TIMESTAMP

    assert len(message_ids) == 1
    return normalized


def _load_fixture(adapter: str) -> dict[str, list[dict[str, Any]]]:
    with (CONTRACT_DATA_DIR / f"{adapter}.json").open() as fixture_file:
        return json.load(fixture_file)


def _local_events(monkeypatch: pytest.MonkeyPatch, *, fail: bool) -> list[dict[str, Any]]:
    service = ChatService(_AgentService())
    monkeypatch.setattr(service, "_build_messages_history", lambda *_args: [object()])
    monkeypatch.setattr(
        service,
        "_get_or_build_graph",
        lambda *_args, **_kwargs: _LocalGraph(fail=fail),
    )
    return asyncio.run(
        _collect_events(
            service.stream_chat_events(
                LOCAL_AGENT_ID,
                CONVERSATION_ID,
                [],
                "What is the weather?",
            )
        )
    )


def _langgraph_events(
    monkeypatch: pytest.MonkeyPatch,
    *,
    fail: bool,
) -> list[dict[str, Any]]:
    service = ChatService(_AgentService())
    remote_service = _RemoteAgentService("langgraph", _LangGraphClient(fail=fail))
    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: remote_service)
    return asyncio.run(
        _collect_events(
            service.stream_remote_agent_events(
                REMOTE_SENDER_ID,
                REMOTE_SERVER_ID,
                REMOTE_AGENT_ID,
                CONVERSATION_ID,
                [],
                "What is the weather?",
            )
        )
    )


def _a2a_events(monkeypatch: pytest.MonkeyPatch, *, fail: bool) -> list[dict[str, Any]]:
    chat_module.a2a_context_cache[f"{REMOTE_SERVER_ID}:{CONVERSATION_ID}"] = "a2a-context-fixed"
    if fail:
        responses = [
            StreamResponse(
                artifact_update=new_text_artifact_update_event(
                    task_id="task-error",
                    context_id="a2a-context-fixed",
                    name="answer",
                    text="Partial",
                    artifact_id="artifact-error",
                )
            )
        ]
    else:
        tool_call = {
            "tool_calls": [
                {
                    "id": "tool-weather-1",
                    "function": {
                        "name": "get_weather",
                        "arguments": {"city": "Oak Ridge"},
                    },
                }
            ]
        }
        responses = [
            StreamResponse(message=new_data_message(tool_call, context_id="a2a-context-fixed")),
            StreamResponse(
                artifact_update=new_data_artifact_update_event(
                    task_id="task-weather",
                    context_id="a2a-context-fixed",
                    name="tool-output",
                    data={
                        "functionResponse": {
                            "id": "tool-weather-1",
                            "name": "get_weather",
                            "response": {"temperature": 72, "unit": "F"},
                        }
                    },
                    artifact_id="artifact-tool",
                    last_chunk=True,
                )
            ),
            StreamResponse(
                artifact_update=new_text_artifact_update_event(
                    task_id="task-weather",
                    context_id="a2a-context-fixed",
                    name="answer",
                    text="It is ",
                    artifact_id="artifact-text",
                )
            ),
            StreamResponse(
                artifact_update=new_text_artifact_update_event(
                    task_id="task-weather",
                    context_id="a2a-context-fixed",
                    name="answer",
                    text="72 F.",
                    append=True,
                    last_chunk=True,
                    artifact_id="artifact-text",
                )
            ),
        ]

    service = ChatService(_AgentService())
    remote_service = _RemoteAgentService("a2a", _A2AClient(responses, fail=fail))
    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: remote_service)
    return asyncio.run(
        _collect_events(
            service.stream_remote_agent_events(
                REMOTE_SENDER_ID,
                REMOTE_SERVER_ID,
                REMOTE_AGENT_ID,
                CONVERSATION_ID,
                [],
                "What is the weather?",
            )
        )
    )


def _agui_events(monkeypatch: pytest.MonkeyPatch, *, fail: bool) -> list[dict[str, Any]]:
    chat_module.agui_thread_cache[f"{REMOTE_SERVER_ID}:{CONVERSATION_ID}"] = "agui-thread-fixed"
    events = [
        '{"type":"RUN_STARTED","threadId":"thread-fixed","runId":"run-fixed"}',
        '{"type":"TEXT_MESSAGE_START","messageId":"upstream-message-1","role":"assistant"}',
    ]
    if fail:
        events.extend(
            [
                '{"type":"TEXT_MESSAGE_CONTENT","messageId":"upstream-message-1",'
                '"delta":"Partial"}',
                '{"type":"RUN_ERROR","message":"AG-UI stream failed"}',
            ]
        )
    else:
        events = [
            '{"type":"RUN_STARTED","threadId":"thread-fixed","runId":"run-fixed"}',
            '{"type":"TOOL_CALL_START","toolCallId":"tool-weather-1",'
            '"toolCallName":"get_weather","parentMessageId":"upstream-message-1"}',
            '{"type":"TOOL_CALL_ARGS","toolCallId":"tool-weather-1","delta":"{\\"city\\":\\"Oak "}',
            '{"type":"TOOL_CALL_ARGS","toolCallId":"tool-weather-1","delta":"Ridge\\"}"}',
            '{"type":"TOOL_CALL_END","toolCallId":"tool-weather-1"}',
            '{"type":"TOOL_CALL_RESULT","messageId":"upstream-tool-result-1",'
            '"toolCallId":"tool-weather-1",'
            '"content":"{\\"temperature\\":72,\\"unit\\":\\"F\\"}"}',
            '{"type":"TEXT_MESSAGE_START","messageId":"upstream-message-1","role":"assistant"}',
            '{"type":"TEXT_MESSAGE_CONTENT","messageId":"upstream-message-1","delta":"It is "}',
            '{"type":"TEXT_MESSAGE_CONTENT","messageId":"upstream-message-1","delta":"72 F."}',
            '{"type":"TEXT_MESSAGE_END","messageId":"upstream-message-1"}',
            '{"type":"RUN_FINISHED","threadId":"thread-fixed","runId":"run-fixed"}',
        ]

    service = ChatService(_AgentService())
    remote_service = _RemoteAgentService("agui", _AGUIClient(events))
    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: remote_service)
    return asyncio.run(
        _collect_events(
            service.stream_remote_agent_events(
                REMOTE_SENDER_ID,
                REMOTE_SERVER_ID,
                REMOTE_AGENT_ID,
                CONVERSATION_ID,
                [],
                "What is the weather?",
            )
        )
    )


@pytest.mark.parametrize(
    ("adapter", "event_factory"),
    [
        ("local", _local_events),
        ("langgraph", _langgraph_events),
        ("a2a", _a2a_events),
        ("agui", _agui_events),
    ],
)
def test_chat_stream_contract(
    monkeypatch: pytest.MonkeyPatch,
    adapter: str,
    event_factory: Any,
) -> None:
    expected = _load_fixture(adapter)

    assert (
        _normalize_generated_values(event_factory(monkeypatch, fail=False)) == expected["success"]
    )
    assert _normalize_generated_values(event_factory(monkeypatch, fail=True)) == expected["error"]
