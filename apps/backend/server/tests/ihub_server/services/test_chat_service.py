import asyncio
import base64
import json
import sys
import uuid
from types import ModuleType, SimpleNamespace

import pytest
from a2a.helpers.proto_helpers import (
    get_message_text,
    new_data_artifact_update_event,
    new_data_message,
    new_text_artifact_update_event,
    new_text_message,
)
from a2a.types import Role, StreamResponse

from ihub_server.services import chat as chat_module
from ihub_server.services.chat import ChatService
from ihub_server.services.errors import ServiceError


@pytest.fixture(autouse=True)
def clear_graph_cache():
    chat_module.graph_cache.clear()
    chat_module.a2a_context_cache.clear()
    chat_module.agui_thread_cache.clear()
    yield
    chat_module.graph_cache.clear()
    chat_module.a2a_context_cache.clear()
    chat_module.agui_thread_cache.clear()


def _install_fake_langchain(monkeypatch):
    messages_module = ModuleType("langchain_core.messages")

    class HumanMessage:
        def __init__(self, content):
            self.content = content

    class AIMessage:
        def __init__(self, content):
            self.content = content

    messages_module.HumanMessage = HumanMessage
    messages_module.AIMessage = AIMessage
    monkeypatch.setitem(sys.modules, "langchain_core.messages", messages_module)


class DummyAgentService:
    def get_agent(self, agent_id):
        return {"id": str(agent_id)}


class StubAgentService:
    def __init__(self, agents):
        self._agents = agents

    def get_agent(self, agent_id):
        return self._agents[uuid.UUID(str(agent_id))]


class FakeGraph:
    def __init__(self, response):
        self._response = response
        self.invoked = False

    def invoke(self, _payload):
        self.invoked = True
        return self._response


def test_chat_returns_message_content(monkeypatch):
    _install_fake_langchain(monkeypatch)
    agent_service = DummyAgentService()
    service = ChatService(agent_service)

    def fake_build(agent_def, conversation_id):
        return FakeGraph({"messages": [SimpleNamespace(content="hello")]})

    monkeypatch.setattr(chat_module.agent_factory, "build", fake_build)

    agent_id = uuid.uuid4()
    messages = [
        SimpleNamespace(role="user", content="hi"),
        SimpleNamespace(role="assistant", content="hey"),
    ]

    result = service.chat(agent_id, "conversation", messages, "new")

    assert result == "hello"


def test_build_messages_history_normalizes_chat_attachments(monkeypatch):
    _install_fake_langchain(monkeypatch)
    service = ChatService(DummyAgentService())
    text_data = base64.b64encode(b"alpha,beta\n1,2").decode("ascii")
    image_data = base64.b64encode(b"fake png bytes").decode("ascii")

    messages = service._build_messages_history(
        [],
        "Compare these files",
        [
            SimpleNamespace(
                name="values.csv",
                mime_type="text/csv",
                size=14,
                data=text_data,
            ),
            SimpleNamespace(
                name="plot.png",
                mime_type="image/png",
                size=14,
                data=image_data,
            ),
        ],
    )

    assert messages[0].content == [
        {"type": "text", "text": "Compare these files"},
        {"type": "text", "text": "Attached file: values.csv\n\nalpha,beta\n1,2"},
        {
            "type": "image",
            "base64": image_data,
            "mime_type": "image/png",
            "extras": {"filename": "plot.png"},
        },
    ]


def test_build_messages_history_restores_persisted_attachment_blocks(monkeypatch):
    _install_fake_langchain(monkeypatch)
    service = ChatService(DummyAgentService())
    monkeypatch.setattr(service, "_extract_pdf_text", lambda _name, _data: "Report text")
    pdf_data = base64.b64encode(b"%PDF").decode("ascii")
    history = [
        SimpleNamespace(
            role="user",
            content=[
                SimpleNamespace(type="text", text="Review this"),
                SimpleNamespace(
                    type="attachment",
                    attachment=SimpleNamespace(
                        name="report.pdf",
                        mime_type="application/pdf",
                        size=4,
                        data=pdf_data,
                    ),
                ),
            ],
        )
    ]

    messages = service._build_messages_history(history, "What changed?")

    assert messages[0].content[0] == {"type": "text", "text": "Review this"}
    assert messages[0].content[1] == {
        "type": "text",
        "text": "Attached file: report.pdf\n\nReport text",
    }
    assert messages[1].content == "What changed?"


def test_build_messages_history_rejects_unsupported_binary_attachments(monkeypatch):
    _install_fake_langchain(monkeypatch)
    service = ChatService(DummyAgentService())

    with pytest.raises(ServiceError, match="binary data that cannot be read as UTF-8"):
        service._build_messages_history(
            [],
            "Review this",
            [
                SimpleNamespace(
                    name="document.docx",
                    mime_type=(
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    ),
                    size=5,
                    data=base64.b64encode(b"PK\x03\x04\xff").decode("ascii"),
                )
            ],
        )


def test_build_messages_history_reads_unknown_extension_as_utf8_text(monkeypatch):
    _install_fake_langchain(monkeypatch)
    service = ChatService(DummyAgentService())
    cif_text = "data_silicon\n_cell_length_a 5.431"

    messages = service._build_messages_history(
        [],
        "Analyze this structure",
        [
            SimpleNamespace(
                name="silicon.cif",
                mime_type="chemical/x-cif",
                size=len(cif_text.encode("utf-8")),
                data=base64.b64encode(cif_text.encode("utf-8")).decode("ascii"),
            )
        ],
    )

    assert messages[0].content == [
        {"type": "text", "text": "Analyze this structure"},
        {"type": "text", "text": f"Attached file: silicon.cif\n\n{cif_text}"},
    ]


def test_chat_handles_dict_response(monkeypatch):
    _install_fake_langchain(monkeypatch)
    agent_service = DummyAgentService()
    service = ChatService(agent_service)

    def fake_build(agent_def, conversation_id):
        return FakeGraph({"messages": [{"content": "dict-response"}]})

    monkeypatch.setattr(chat_module.agent_factory, "build", fake_build)

    result = service.chat(uuid.uuid4(), "conversation", [], "hi")

    assert result == "dict-response"


def test_chat_handles_errors(monkeypatch):
    _install_fake_langchain(monkeypatch)
    agent_service = DummyAgentService()
    service = ChatService(agent_service)

    class ErrorGraph:
        def invoke(self, _payload):
            raise RuntimeError("boom")

    def fake_build(*_args, **_kwargs):
        return ErrorGraph()

    monkeypatch.setattr(chat_module.agent_factory, "build", fake_build)

    with pytest.raises(ServiceError):
        service.chat(uuid.uuid4(), "conversation", [], "hi")


def test_clear_conversation_removes_cache_and_override_variants():
    agent_id = uuid.uuid4()
    base_key = f"{agent_id}:conversation"
    suffixed_key = f"{base_key}:supervisor:a,b"
    other_key = f"{agent_id}:other"
    chat_module.graph_cache[base_key] = "graph"
    chat_module.graph_cache[suffixed_key] = "override-graph"
    chat_module.graph_cache[other_key] = "other-graph"

    service = ChatService(DummyAgentService())
    service.clear_conversation(agent_id, "conversation")

    assert base_key not in chat_module.graph_cache
    assert suffixed_key not in chat_module.graph_cache
    assert chat_module.graph_cache[other_key] == "other-graph"


def test_get_or_build_graph_caches(monkeypatch):
    agent_service = DummyAgentService()
    service = ChatService(agent_service)

    build_calls = []

    def fake_build(agent_def, conversation_id):
        build_calls.append((agent_def, conversation_id))
        return FakeGraph({"messages": []})

    monkeypatch.setattr(chat_module.agent_factory, "build", fake_build)

    agent_id = uuid.uuid4()
    graph_one = service._get_or_build_graph(agent_id, "conversation", {})
    graph_two = service._get_or_build_graph(agent_id, "conversation", {})

    assert graph_one is graph_two
    assert len(build_calls) == 1


def test_get_or_build_graph_handles_errors(monkeypatch):
    agent_service = DummyAgentService()
    service = ChatService(agent_service)

    def fake_build(*_args, **_kwargs):
        raise ValueError("nope")

    monkeypatch.setattr(chat_module.agent_factory, "build", fake_build)

    with pytest.raises(ServiceError):
        service._get_or_build_graph(uuid.uuid4(), "conversation", {})


def test_chat_returns_empty_for_no_messages(monkeypatch):
    _install_fake_langchain(monkeypatch)
    agent_service = DummyAgentService()
    service = ChatService(agent_service)

    def fake_build(agent_def, conversation_id):
        return FakeGraph({"messages": []})

    monkeypatch.setattr(chat_module.agent_factory, "build", fake_build)

    result = service.chat(uuid.uuid4(), "conversation", [], "hi")

    assert result == ""


def test_chat_falls_back_to_string(monkeypatch):
    _install_fake_langchain(monkeypatch)
    agent_service = DummyAgentService()
    service = ChatService(agent_service)

    def fake_build(agent_def, conversation_id):
        return FakeGraph({"messages": ["plain"]})

    monkeypatch.setattr(chat_module.agent_factory, "build", fake_build)

    result = service.chat(uuid.uuid4(), "conversation", [], "hi")

    assert result == "plain"


async def _collect_events(async_iterable):
    events = []
    async for event in async_iterable:
        events.append(event)
    return events


def test_stream_chat_events_uses_astream_and_emits_tool_and_message_events(monkeypatch):
    _install_fake_langchain(monkeypatch)
    service = ChatService(DummyAgentService())
    agent_id = uuid.uuid4()

    tool_call_message = SimpleNamespace(
        tool_calls=[{"id": "tool-1", "name": "search", "args": {"query": "hello"}}],
        content="",
    )
    text_message = SimpleNamespace(content=[{"type": "text", "text": "Hello "}, "world"])
    tool_result_message = SimpleNamespace(
        type="tool",
        tool_call_id="tool-1",
        name="search",
        content='{"result":"done"}',
    )

    class StreamingGraph:
        async def astream(self, _payload, stream_mode=None):
            assert stream_mode == "values"
            yield {"messages": [SimpleNamespace(content="existing"), tool_call_message]}
            yield {
                "messages": [SimpleNamespace(content="existing"), tool_call_message, text_message]
            }
            yield {
                "messages": [
                    SimpleNamespace(content="existing"),
                    tool_call_message,
                    text_message,
                    tool_result_message,
                ]
            }

    monkeypatch.setattr(service, "_get_or_build_graph", lambda *_args, **_kwargs: StreamingGraph())

    events = asyncio.run(
        _collect_events(service.stream_chat_events(agent_id, "conversation", [], "hi"))
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "tool.start",
        "tool.progress",
        "message.delta",
        "tool.progress",
        "tool.result",
        "message.complete",
    ]
    assert events[1]["toolName"] == "search"
    assert events[3]["delta"] == "Hello world"
    assert events[5]["result"] == {"result": "done"}
    assert events[-1]["content"] == "Hello world"


def test_stream_chat_events_falls_back_to_chat(monkeypatch):
    service = ChatService(DummyAgentService())
    agent_id = uuid.uuid4()
    monkeypatch.setattr(service, "_get_or_build_graph", lambda *_args, **_kwargs: SimpleNamespace())
    monkeypatch.setattr(service, "chat", lambda *_args, **_kwargs: "fallback reply")

    events = asyncio.run(
        _collect_events(service.stream_chat_events(agent_id, "conversation", [], "hi"))
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "message.delta",
        "message.complete",
    ]
    assert events[1]["delta"] == "fallback reply"
    assert events[2]["content"] == "fallback reply"


def test_stream_chat_events_emits_complete_then_error_when_stream_fails(monkeypatch):
    _install_fake_langchain(monkeypatch)
    service = ChatService(DummyAgentService())
    agent_id = uuid.uuid4()

    class ErrorStreamingGraph:
        async def astream(self, _payload, stream_mode=None):
            yield {
                "messages": [
                    SimpleNamespace(content="existing"),
                    SimpleNamespace(content="partial"),
                ]
            }
            raise RuntimeError("boom")

    monkeypatch.setattr(
        service, "_get_or_build_graph", lambda *_args, **_kwargs: ErrorStreamingGraph()
    )

    events = asyncio.run(
        _collect_events(service.stream_chat_events(agent_id, "conversation", [], "hi"))
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "message.delta",
        "message.complete",
        "error",
    ]
    assert events[2]["content"] == "partial"
    assert events[3]["error"] == "Agent invocation failed: boom"


def test_chat_helper_methods_cover_message_and_tool_parsing(monkeypatch):
    service = ChatService(DummyAgentService())
    agent_id = uuid.uuid4()
    conversation_id = "conversation"
    sender_id = str(agent_id)

    class TextWrapper:
        def __init__(self, text):
            self.text = text

    class FallbackToolMessage:
        def __str__(self):
            return "fallback"

    tool_call_message = SimpleNamespace(
        tool_calls=[{"id": "tool-1", "name": "search", "args": {"query": "abc"}}],
        content="",
    )
    text_message = SimpleNamespace(content=["hello", {"type": "text", "text": " world"}])
    tool_message = SimpleNamespace(
        type="tool",
        tool_call_id="tool-1",
        tool_name="search",
        content=[{"text": '```json\n{"value": 1}\n```'}],
    )

    events = service._events_from_graph_messages(
        conversation_id,
        "assistant-id",
        sender_id,
        [tool_call_message, text_message, tool_message],
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "tool.start",
        "tool.progress",
        "message.delta",
        "tool.progress",
        "tool.result",
    ]
    assert service._extract_graph_messages({"messages": [1, 2]}) == [1, 2]
    assert service._extract_graph_messages({"messages": "nope"}) == []
    assert service._extract_graph_messages("bad") == []
    assert service._extract_message_text(SimpleNamespace(type="tool", content="ignored")) == ""
    assert service._extract_message_text(SimpleNamespace(content="plain")) == "plain"
    assert service._extract_message_text(text_message) == "hello world"
    assert (
        service._extract_message_text(SimpleNamespace(content=[{"type": "image", "text": "skip"}]))
        == ""
    )
    assert service._extract_message_text(SimpleNamespace(content=123)) == ""
    assert service._extract_tool_output(SimpleNamespace(content={"ok": True})) == {"ok": True}
    assert service._extract_tool_output(
        SimpleNamespace(
            content="model summary",
            artifact={
                "content": [
                    {
                        "type": "image",
                        "data": "iVBORw0KGgo=",
                        "mimeType": "image/png",
                    }
                ],
                "structuredContent": {"n_atoms": 15},
            },
        )
    ) == {
        "content": [
            {
                "type": "image",
                "data": "iVBORw0KGgo=",
                "mimeType": "image/png",
            }
        ],
        "structuredContent": {"n_atoms": 15},
    }
    assert service._extract_tool_output(FallbackToolMessage()) == "fallback"
    assert service._coerce_structured_tool_output('{"key": 1}') == {"key": 1}
    assert service._coerce_structured_tool_output("```json\n[1, 2]\n```") == [1, 2]
    assert service._coerce_structured_tool_output('prefix {"a": 1} suffix') == {"a": 1}
    assert service._coerce_structured_tool_output("prefix [1, 2] suffix") == [1, 2]
    assert service._coerce_structured_tool_output(TextWrapper('{"wrapped": true}')) == {
        "wrapped": True
    }
    assert service._coerce_structured_tool_output([{"json": {"direct": True}}]) == {"direct": True}
    assert service._coerce_structured_tool_output([{"data": [1, 2]}]) == [1, 2]
    assert (
        service._coerce_structured_tool_output(
            [{"text": "plain"}, TextWrapper("text"), {"ignored": True}]
        )
        == "plain\ntext"
    )
    assert service._coerce_structured_tool_output([{"ignored": True}]) == [{"ignored": True}]
    assert service._parse_json_like_text("") is None
    assert service._parse_json_like_text("not json") is None
    assert service._parse_json_like_text("```json\n{invalid}\n```") is None
    assert service._is_tool_message(SimpleNamespace(type="tool")) is True
    assert service._is_tool_message(SimpleNamespace(tool_call_id="tool-1")) is True
    assert service._is_tool_message(SimpleNamespace(type="ai")) is False
    cache_key = service._build_cache_key(
        agent_id,
        conversation_id,
        {"supervisor_agent_id": "supervisor", "participant_agent_ids": ["b", "a"]},
    )
    assert cache_key.endswith(":supervisor:a,b:tools")


def test_chat_runtime_overrides_and_override_cache_key(monkeypatch):
    service = ChatService(DummyAgentService())
    valid_supervisor = str(uuid.uuid4()).upper()
    valid_participant = str(uuid.uuid4()).upper()
    duplicate_participant = valid_participant.lower()

    overrides = service._build_runtime_overrides(
        "not-a-uuid",
        [valid_participant, "still-not-a-uuid", duplicate_participant],
    )
    assert overrides == {"participant_agent_ids": [str(uuid.UUID(valid_participant))]}

    overrides = service._build_runtime_overrides(valid_supervisor, [valid_participant])
    assert overrides == {
        "supervisor_agent_id": str(uuid.UUID(valid_supervisor)),
        "participant_agent_ids": [str(uuid.UUID(valid_participant))],
    }

    build_calls = []

    def fake_build(*args, **kwargs):
        build_calls.append((args, kwargs))
        return FakeGraph({"messages": []})

    monkeypatch.setattr(chat_module.agent_factory, "build", fake_build)

    graph = service._get_or_build_graph(uuid.uuid4(), "conversation", {"id": "agent"}, overrides)

    assert isinstance(graph, FakeGraph)
    assert build_calls[0][1] == {
        "agent_def": {"id": "agent"},
        "conversation_id": "conversation",
        "runtime_overrides": overrides,
    }


def test_stream_chat_events_uses_runtime_overrides_and_skips_non_advanced_states(monkeypatch):
    _install_fake_langchain(monkeypatch)
    service = ChatService(DummyAgentService())
    agent_id = uuid.uuid4()
    get_graph_calls = []

    class StreamingGraph:
        async def astream(self, payload, stream_mode=None):
            assert stream_mode == "values"
            assert len(payload["messages"]) == 2
            yield {"messages": payload["messages"]}
            yield {
                "messages": payload["messages"]
                + [
                    SimpleNamespace(content="assistant reply"),
                ]
            }
            yield {
                "messages": payload["messages"]
                + [
                    SimpleNamespace(content="assistant reply"),
                ]
            }

    def fake_get_graph(*args):
        get_graph_calls.append(args)
        return StreamingGraph()

    monkeypatch.setattr(service, "_get_or_build_graph", fake_get_graph)

    history = [SimpleNamespace(role="assistant", content="earlier")]
    events = asyncio.run(
        _collect_events(
            service.stream_chat_events(
                agent_id,
                "conversation",
                history,
                "hi",
                supervisor_agent_id=str(uuid.uuid4()),
                participant_agent_ids=[str(uuid.uuid4())],
            )
        )
    )

    assert len(get_graph_calls) == 1
    assert get_graph_calls[0][0] == agent_id
    assert get_graph_calls[0][1] == "conversation"
    assert get_graph_calls[0][2] == {"id": str(agent_id)}
    assert set(get_graph_calls[0][3]) == {"supervisor_agent_id", "participant_agent_ids"}
    assert [event["type"] for event in events] == [
        "message.start",
        "message.delta",
        "message.complete",
    ]
    assert events[1]["delta"] == "assistant reply"
    assert events[2]["content"] == "assistant reply"


def test_stream_chat_events_falls_back_after_no_streamed_events_with_runtime_overrides(monkeypatch):
    _install_fake_langchain(monkeypatch)
    service = ChatService(DummyAgentService())
    agent_id = uuid.uuid4()
    chat_calls = []

    class SilentStreamingGraph:
        async def astream(self, payload, stream_mode=None):
            assert stream_mode == "values"
            yield {"messages": payload["messages"]}

    monkeypatch.setattr(
        service, "_get_or_build_graph", lambda *_args, **_kwargs: SilentStreamingGraph()
    )

    def fake_chat(*args, **kwargs):
        chat_calls.append((args, kwargs))
        return "fallback reply"

    monkeypatch.setattr(service, "chat", fake_chat)

    supervisor_id = str(uuid.uuid4())
    participant_ids = [str(uuid.uuid4())]
    events = asyncio.run(
        _collect_events(
            service.stream_chat_events(
                agent_id,
                "conversation",
                [SimpleNamespace(role="user", content="before")],
                "hi",
                supervisor_agent_id=supervisor_id,
                participant_agent_ids=participant_ids,
            )
        )
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "message.delta",
        "message.complete",
    ]
    assert chat_calls == [
        (
            (
                agent_id,
                "conversation",
                [SimpleNamespace(role="user", content="before")],
                "hi",
                supervisor_id,
                participant_ids,
            ),
            {},
        )
    ]


def test_mixed_group_streams_local_and_remote_reports_then_supervisor(monkeypatch):
    supervisor_id = uuid.uuid4()
    local_participant_id = uuid.uuid4()
    remote_selector = "remote:7:researcher"
    agent_service = StubAgentService(
        {
            supervisor_id: SimpleNamespace(
                id=supervisor_id,
                name="Lead",
                graph_type="supervisor",
            ),
            local_participant_id: SimpleNamespace(
                id=local_participant_id,
                name="Local analyst",
                graph_type="react",
            ),
        }
    )
    remote_service = SimpleNamespace(
        get_discovered_remote_agent=lambda server_id, remote_id: SimpleNamespace(
            name="Remote researcher",
            remote_agent_id=server_id,
            assistant_id=remote_id,
        )
    )
    service = ChatService(agent_service, remote_service)
    local_calls = []
    remote_calls = []

    async def fake_local_stream(agent_id, conversation_id, messages, message, **kwargs):
        local_calls.append((agent_id, conversation_id, messages, message, kwargs))
        sender_id = str(agent_id)
        content = "local report" if agent_id == local_participant_id else "final synthesis"
        message_id = f"message-{len(local_calls)}"
        yield service._message_start_event(conversation_id, message_id, sender_id)
        yield {
            "type": "message.delta",
            "conversationId": conversation_id,
            "messageId": message_id,
            "delta": content,
        }
        yield {
            "type": "message.complete",
            "conversationId": conversation_id,
            "messageId": message_id,
            "content": content,
        }

    async def fake_remote_stream(**kwargs):
        remote_calls.append(kwargs)
        yield service._message_start_event(
            kwargs["conversation_id"],
            "message-remote",
            kwargs["remote_sender_id"],
        )
        yield {
            "type": "tool.start",
            "conversationId": kwargs["conversation_id"],
            "messageId": "message-remote",
            "toolCallId": "tool-1",
            "toolName": "search",
            "timestamp": "2026-01-01T00:00:00+00:00",
        }
        yield {
            "type": "message.complete",
            "conversationId": kwargs["conversation_id"],
            "messageId": "message-remote",
            "content": "remote report",
        }

    monkeypatch.setattr(service, "stream_chat_events", fake_local_stream)
    monkeypatch.setattr(service, "stream_remote_agent_events", fake_remote_stream)

    async def synthesize_plan(**kwargs):
        return chat_module._GroupPlan(
            action="delegate",
            participants=tuple(kwargs["participants"]),
            response_mode="synthesize",
            task="Investigate with both specialists",
        )

    monkeypatch.setattr(service, "_plan_group_turn", synthesize_plan)

    events = asyncio.run(
        _collect_events(
            service._stream_mixed_group_events(
                supervisor_agent_id=supervisor_id,
                supervisor_agent_def=agent_service.get_agent(supervisor_id),
                conversation_id="room-1",
                messages=[],
                message="Investigate this",
                participant_agent_ids=[str(local_participant_id), remote_selector],
                attachments=None,
            )
        )
    )

    starts = [event for event in events if event["type"] == "message.start"]
    assert [event["senderId"] for event in starts] == [
        remote_selector,
        str(supervisor_id),
    ]
    assert all(event["conversationId"] == "room-1" for event in events)
    assert any(event["type"] == "tool.start" for event in events)
    assert remote_calls[0]["remote_agent_server_id"] == 7
    assert remote_calls[0]["remote_agent_id"] == "researcher"
    synthesis_prompt = local_calls[-1][3]
    assert "local report" in synthesis_prompt
    assert "remote report" in synthesis_prompt
    assert "Investigate this" in synthesis_prompt


def test_group_planner_selects_one_authoritative_participant(monkeypatch):
    supervisor_id = uuid.uuid4()
    participant = chat_module._GroupParticipant(
        selector_id="remote:7:researcher",
        name="Researcher",
        remote_agent_server_id=7,
        remote_agent_id="researcher",
    )
    service = ChatService(DummyAgentService())

    monkeypatch.setattr(
        service,
        "chat",
        lambda *_args, **_kwargs: json.dumps(
            {
                "action": "delegate",
                "participantIds": [participant.selector_id],
                "responseMode": "participant_only",
                "task": "Find the source",
            }
        ),
    )

    plan = asyncio.run(
        service._plan_group_turn(
            supervisor_agent_id=supervisor_id,
            supervisor_name="Lead",
            conversation_id="room-1",
            messages=[],
            message="Please research this",
            attachments=None,
            participants=[participant],
        )
    )

    assert plan.action == "delegate"
    assert plan.participants == (participant,)
    assert plan.response_mode == "participant_only"
    assert plan.task == "Find the source"


def test_group_planner_falls_back_to_direct_for_invalid_selection(monkeypatch):
    service = ChatService(DummyAgentService())
    participant = chat_module._GroupParticipant(
        selector_id="remote:7:researcher",
        name="Researcher",
        remote_agent_server_id=7,
        remote_agent_id="researcher",
    )
    monkeypatch.setattr(
        service,
        "chat",
        lambda *_args, **_kwargs: '{"action":"delegate","participantIds":["unknown"]}',
    )

    plan = asyncio.run(
        service._plan_group_turn(
            supervisor_agent_id=uuid.uuid4(),
            supervisor_name="Lead",
            conversation_id="room-1",
            messages=[],
            message="hello",
            attachments=None,
            participants=[participant],
        )
    )

    assert plan == chat_module._GroupPlan(action="direct")


def test_group_planner_routes_explicit_mention_without_llm(monkeypatch):
    service = ChatService(DummyAgentService())
    participant = chat_module._GroupParticipant(
        selector_id="remote:7:researcher",
        name="Remote Researcher",
        remote_agent_server_id=7,
        remote_agent_id="researcher",
    )

    def unexpected_chat(*_args, **_kwargs):
        pytest.fail("Explicit mentions must not call the supervisor planner")

    monkeypatch.setattr(service, "chat", unexpected_chat)

    plan = asyncio.run(
        service._plan_group_turn(
            supervisor_agent_id=uuid.uuid4(),
            supervisor_name="Lead",
            conversation_id="room-1",
            messages=[],
            message="@Remote Researcher check this",
            attachments=None,
            participants=[participant],
        )
    )

    assert plan.participants == (participant,)
    assert plan.response_mode == "participant_only"


def test_group_planner_routes_supervisor_mention_directly(monkeypatch):
    service = ChatService(DummyAgentService())

    def unexpected_chat(*_args, **_kwargs):
        pytest.fail("Explicit supervisor mentions must bypass the LLM planner")

    monkeypatch.setattr(service, "chat", unexpected_chat)

    plan = asyncio.run(
        service._plan_group_turn(
            supervisor_agent_id=uuid.uuid4(),
            supervisor_name="Planning Lead",
            conversation_id="room-1",
            messages=[],
            message="@supervisor what do you think?",
            attachments=None,
            participants=[],
        )
    )

    assert plan == chat_module._GroupPlan(action="direct")


def test_group_planner_attributes_worker_history_in_routing_prompt(monkeypatch):
    service = ChatService(DummyAgentService())
    supervisor_id = uuid.uuid4()
    participant = chat_module._GroupParticipant(
        selector_id="remote:7:researcher",
        name="Researcher",
        remote_agent_server_id=7,
        remote_agent_id="researcher",
    )
    chat_calls = []

    def fake_chat(*args, **kwargs):
        chat_calls.append((args, kwargs))
        return '{"action":"direct"}'

    monkeypatch.setattr(service, "chat", fake_chat)

    asyncio.run(
        service._plan_group_turn(
            supervisor_agent_id=supervisor_id,
            supervisor_name="Lead",
            conversation_id="room-1",
            messages=[
                SimpleNamespace(
                    role="assistant",
                    sender_id=participant.selector_id,
                    content="Worker answer",
                )
            ],
            message="What is your view?",
            attachments=None,
            participants=[participant],
        )
    )

    assert chat_calls[0][0][2] == []
    planning_prompt = chat_calls[0][0][3]
    assert "Researcher: Worker answer" in planning_prompt
    assert "does not own future turns" in planning_prompt


def test_mixed_group_rejects_a_remote_lead():
    service = ChatService(DummyAgentService(), SimpleNamespace())

    events = asyncio.run(
        _collect_events(
            service._stream_mixed_group_events(
                supervisor_agent_id=uuid.uuid4(),
                supervisor_agent_def=SimpleNamespace(graph_type="react"),
                conversation_id="room-1",
                messages=[],
                message="hello",
                participant_agent_ids=["remote:7:researcher"],
                attachments=None,
            )
        )
    )

    assert events[0]["type"] == "error"
    assert "local supervisor" in events[0]["error"]


def test_mixed_group_continues_to_supervisor_when_participant_raises(monkeypatch):
    supervisor_id = uuid.uuid4()
    supervisor = SimpleNamespace(
        id=supervisor_id,
        name="Lead",
        graph_type="supervisor",
    )
    service = ChatService(
        StubAgentService({supervisor_id: supervisor}),
        SimpleNamespace(get_discovered_remote_agent=lambda *_args: SimpleNamespace(name="Remote")),
    )
    supervisor_prompts = []

    async def failing_remote_stream(**_kwargs):
        raise RuntimeError("offline")
        yield

    async def supervisor_stream(agent_id, conversation_id, messages, message, **_kwargs):
        supervisor_prompts.append(message)
        yield service._message_start_event(
            conversation_id,
            "message-supervisor",
            str(agent_id),
        )
        yield {
            "type": "message.complete",
            "conversationId": conversation_id,
            "messageId": "message-supervisor",
            "content": "fallback synthesis",
        }

    monkeypatch.setattr(service, "stream_remote_agent_events", failing_remote_stream)
    monkeypatch.setattr(service, "stream_chat_events", supervisor_stream)

    async def synthesize_plan(**kwargs):
        return chat_module._GroupPlan(
            action="delegate",
            participants=tuple(kwargs["participants"]),
            response_mode="synthesize",
            task="Ask the remote specialist",
        )

    monkeypatch.setattr(service, "_plan_group_turn", synthesize_plan)

    events = asyncio.run(
        _collect_events(
            service._stream_mixed_group_events(
                supervisor_agent_id=supervisor_id,
                supervisor_agent_def=supervisor,
                conversation_id="room-1",
                messages=[],
                message="hello",
                participant_agent_ids=["remote:7:researcher"],
                attachments=None,
            )
        )
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "error",
        "message.start",
        "message.complete",
    ]
    assert events[0]["senderId"] == "remote:7:researcher"
    assert "no report was returned" in supervisor_prompts[0]


def test_clear_mixed_group_conversation_clears_isolated_participant_state():
    supervisor_id = uuid.uuid4()
    local_participant_id = uuid.uuid4()
    remote_selector = "remote:7:researcher"
    service = ChatService(
        DummyAgentService(),
        SimpleNamespace(get_remote_agent=lambda _server_id: SimpleNamespace(protocol="a2a")),
    )
    room_id = "room-1"
    local_conversation_id = service._group_participant_conversation_id(
        room_id,
        str(local_participant_id),
    )
    remote_conversation_id = service._group_participant_conversation_id(
        room_id,
        remote_selector,
    )
    supervisor_conversation_id = service._group_supervisor_conversation_id(room_id)
    chat_module.graph_cache[f"{supervisor_id}:{supervisor_conversation_id}"] = object()
    chat_module.graph_cache[f"{local_participant_id}:{local_conversation_id}"] = object()
    chat_module.a2a_context_cache[f"7:{remote_conversation_id}"] = "context-1"

    service.clear_mixed_group_conversation(
        supervisor_id,
        room_id,
        [str(local_participant_id), remote_selector],
    )

    assert chat_module.graph_cache == {}
    assert chat_module.a2a_context_cache == {}


def test_events_from_graph_messages_uses_default_tool_metadata_and_tool_first_start():
    service = ChatService(DummyAgentService())

    tool_call_message = SimpleNamespace(tool_calls=[{"args": {"x": 1}}], content="")
    tool_result_message = SimpleNamespace(type="tool", content="done")

    events = service._events_from_graph_messages(
        "conversation",
        "assistant-id",
        "sender-id",
        [tool_result_message, tool_call_message],
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "tool.progress",
        "tool.result",
        "tool.start",
        "tool.progress",
    ]
    assert events[1]["toolCallId"]
    assert events[2]["toolName"] == "tool"
    assert events[3]["toolName"] == "tool"
    assert events[3]["toolCallId"]


def test_chat_helper_methods_cover_additional_tool_output_and_json_fallthroughs():
    service = ChatService(DummyAgentService())

    marker = object()
    assert service._coerce_structured_tool_output(marker) is marker
    assert service._coerce_structured_tool_output([{"ignored": True}]) == [{"ignored": True}]
    assert service._parse_json_like_text("```json\n{invalid}\n```") is None
    assert service._parse_json_like_text("prefix {invalid} suffix") is None
    assert service._parse_json_like_text("prefix [invalid] suffix") is None


def test_get_or_build_graph_without_overrides_uses_positional_build(monkeypatch):
    service = ChatService(DummyAgentService())
    build_calls = []

    def fake_build(*args, **kwargs):
        build_calls.append((args, kwargs))
        return FakeGraph({"messages": []})

    monkeypatch.setattr(chat_module.agent_factory, "build", fake_build)

    agent_id = uuid.uuid4()
    graph = service._get_or_build_graph(agent_id, "conversation", {"id": "agent"}, None)

    assert isinstance(graph, FakeGraph)
    assert build_calls == [(({"id": "agent"}, "conversation"), {})]


def test_build_remote_messages_only_sends_current_user_turn():
    service = ChatService(DummyAgentService())

    history = [
        SimpleNamespace(role="user", content="hello"),
        SimpleNamespace(role="assistant", content="hi there"),
    ]

    remote_messages = service._build_remote_messages(history, "latest question")

    assert remote_messages == [{"role": "user", "content": "latest question"}]


def test_stream_remote_chat_events_skips_prior_thread_messages(monkeypatch):
    service = ChatService(DummyAgentService())

    history = [
        SimpleNamespace(role="user", content="old user"),
        SimpleNamespace(role="assistant", content="old assistant"),
    ]

    prior_msgs = [
        {"id": "msg-1", "type": "human", "content": "old user"},
        {"id": "msg-2", "type": "ai", "content": "old assistant"},
    ]

    class FakeThreads:
        async def get_state(self, _thread_id):
            return {"values": {"messages": prior_msgs}}

    class FakeRuns:
        async def stream(self, **_kwargs):
            state = {
                "messages": [
                    *prior_msgs,
                    {"id": "msg-3", "type": "human", "content": "latest question"},
                    {"id": "msg-4", "type": "ai", "content": "fresh reply"},
                ]
            }
            yield SimpleNamespace(event="values", data=state)

    class FakeAsyncClient:
        def __init__(self):
            self.threads = FakeThreads()
            self.runs = FakeRuns()
            self.closed = False

        async def aclose(self):
            self.closed = True

    class FakeRemoteService:
        def get_remote_agent(self, _remote_agent_id):
            return SimpleNamespace(assistant_id="assistant-1")

        def get_async_client(self, _remote_agent):
            return FakeAsyncClient()

    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: FakeRemoteService())

    events = asyncio.run(
        _collect_events(
            service._stream_remote_chat_events(
                agent_id="remote:1:assistant-1",
                remote_agent_id=1,
                assistant_id_override="assistant-1",
                conversation_id="conversation",
                messages=history,
                message="latest question",
            )
        )
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "message.delta",
        "message.complete",
    ]
    assert events[1]["delta"] == "fresh reply"
    assert events[2]["content"] == "fresh reply"


def test_stream_remote_chat_events_skips_replayed_assistant_text_without_ids(monkeypatch):
    service = ChatService(DummyAgentService())

    history = [
        SimpleNamespace(role="user", content="old user"),
        SimpleNamespace(role="assistant", content="old assistant"),
    ]
    prior_msgs = [
        {"id": "msg-1", "type": "human", "content": "old user"},
        {"id": "msg-2", "type": "ai", "content": "old assistant"},
    ]

    class FakeThreads:
        async def get_state(self, _thread_id):
            return {"values": {"messages": prior_msgs}}

    class FakeRuns:
        async def stream(self, **_kwargs):
            yield SimpleNamespace(
                event="values",
                data={
                    "messages": [
                        {"type": "human", "content": "old user"},
                        {"type": "ai", "content": "old assistant"},
                        {"type": "human", "content": "latest question"},
                        {"type": "ai", "content": "fresh reply"},
                    ]
                },
            )

    class FakeAsyncClient:
        def __init__(self):
            self.threads = FakeThreads()
            self.runs = FakeRuns()

        async def aclose(self):
            return None

    class FakeRemoteService:
        def get_remote_agent(self, _remote_agent_id):
            return SimpleNamespace(assistant_id="assistant-1")

        def get_async_client(self, _remote_agent):
            return FakeAsyncClient()

    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: FakeRemoteService())

    events = asyncio.run(
        _collect_events(
            service._stream_remote_chat_events(
                agent_id="remote:1:assistant-1",
                remote_agent_id=1,
                assistant_id_override="assistant-1",
                conversation_id="conversation",
                messages=history,
                message="latest question",
            )
        )
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "message.delta",
        "message.complete",
    ]
    assert events[1]["delta"] == "fresh reply"
    assert events[2]["content"] == "fresh reply"


def test_stream_remote_chat_events_skips_replayed_assistant_text_with_whitespace_drift(
    monkeypatch,
):
    service = ChatService(DummyAgentService())

    history = [
        SimpleNamespace(role="user", content="old user"),
        SimpleNamespace(
            role="assistant",
            content="Hello there.  \n\nScience joke while you decide:",
        ),
    ]
    prior_msgs = [
        {"id": "msg-1", "type": "human", "content": "old user"},
        {
            "id": "msg-2",
            "type": "ai",
            "content": "Hello there.\nScience joke while you decide:",
        },
    ]

    class FakeThreads:
        async def get_state(self, _thread_id):
            return {"values": {"messages": prior_msgs}}

    class FakeRuns:
        async def stream(self, **_kwargs):
            yield SimpleNamespace(
                event="values",
                data={
                    "messages": [
                        {"type": "human", "content": "old user"},
                        {
                            "type": "ai",
                            "content": "Hello there.\nScience joke while you decide:",
                        },
                        {"type": "human", "content": "latest question"},
                        {"type": "ai", "content": "new answer"},
                    ]
                },
            )

    class FakeAsyncClient:
        def __init__(self):
            self.threads = FakeThreads()
            self.runs = FakeRuns()

        async def aclose(self):
            return None

    class FakeRemoteService:
        def get_remote_agent(self, _remote_agent_id):
            return SimpleNamespace(assistant_id="assistant-1")

        def get_async_client(self, _remote_agent):
            return FakeAsyncClient()

    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: FakeRemoteService())

    events = asyncio.run(
        _collect_events(
            service._stream_remote_chat_events(
                agent_id="remote:1:assistant-1",
                remote_agent_id=1,
                assistant_id_override="assistant-1",
                conversation_id="conversation",
                messages=history,
                message="latest question",
            )
        )
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "message.delta",
        "message.complete",
    ]
    assert events[1]["delta"] == "new answer"
    assert events[2]["content"] == "new answer"


def test_stream_remote_chat_events_emits_reply_when_state_omits_current_user(monkeypatch):
    service = ChatService(DummyAgentService())

    history = [
        SimpleNamespace(role="user", content="old user"),
        SimpleNamespace(role="assistant", content="old assistant"),
    ]
    prior_msgs = [
        {"id": "msg-1", "type": "human", "content": "old user"},
        {"id": "msg-2", "type": "ai", "content": "old assistant"},
    ]

    class FakeThreads:
        async def get_state(self, _thread_id):
            return {"values": {"messages": prior_msgs}}

    class FakeRuns:
        async def stream(self, **_kwargs):
            state = {
                "messages": [
                    *prior_msgs,
                    {"id": "msg-3", "type": "ai", "content": "fresh reply"},
                ]
            }
            yield SimpleNamespace(event="values", data=state)

    class FakeAsyncClient:
        def __init__(self):
            self.threads = FakeThreads()
            self.runs = FakeRuns()

        async def aclose(self):
            return None

    class FakeRemoteService:
        def get_remote_agent(self, _remote_agent_id):
            return SimpleNamespace(assistant_id="assistant-1")

        def get_async_client(self, _remote_agent):
            return FakeAsyncClient()

    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: FakeRemoteService())

    events = asyncio.run(
        _collect_events(
            service._stream_remote_chat_events(
                agent_id="remote:1:assistant-1",
                remote_agent_id=1,
                assistant_id_override="assistant-1",
                conversation_id="conversation",
                messages=history,
                message="latest question",
            )
        )
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "message.delta",
        "message.complete",
    ]
    assert events[1]["delta"] == "fresh reply"
    assert events[2]["content"] == "fresh reply"


def test_stream_remote_chat_events_emits_reply_when_history_includes_current_user(
    monkeypatch,
):
    service = ChatService(DummyAgentService())

    # Matches frontend behavior: the latest user message can appear in both
    # `messages` history and the standalone `message` field.
    history = [
        SimpleNamespace(role="user", content="old user"),
        SimpleNamespace(role="assistant", content="old assistant"),
        SimpleNamespace(role="user", content="latest question"),
    ]
    prior_msgs = [
        {"id": "msg-1", "type": "human", "content": "old user"},
        {"id": "msg-2", "type": "ai", "content": "old assistant"},
    ]

    class FakeThreads:
        async def get_state(self, _thread_id):
            return {"values": {"messages": prior_msgs}}

    class FakeRuns:
        async def stream(self, **_kwargs):
            state = {
                "messages": [
                    *prior_msgs,
                    {"id": "msg-3", "type": "ai", "content": "fresh reply"},
                ]
            }
            yield SimpleNamespace(event="values", data=state)

    class FakeAsyncClient:
        def __init__(self):
            self.threads = FakeThreads()
            self.runs = FakeRuns()

        async def aclose(self):
            return None

    class FakeRemoteService:
        def get_remote_agent(self, _remote_agent_id):
            return SimpleNamespace(assistant_id="assistant-1")

        def get_async_client(self, _remote_agent):
            return FakeAsyncClient()

    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: FakeRemoteService())

    events = asyncio.run(
        _collect_events(
            service._stream_remote_chat_events(
                agent_id="remote:1:assistant-1",
                remote_agent_id=1,
                assistant_id_override="assistant-1",
                conversation_id="conversation",
                messages=history,
                message="latest question",
            )
        )
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "message.delta",
        "message.complete",
    ]
    assert events[1]["delta"] == "fresh reply"
    assert events[2]["content"] == "fresh reply"


def test_stream_remote_chat_events_emits_incremental_deltas_across_snapshots(monkeypatch):
    """Each snapshot for the same message ID emits only the new suffix, not the full content."""
    service = ChatService(DummyAgentService())

    # No prior thread history — new conversation.
    class FakeThreads:
        async def get_state(self, _thread_id):
            raise RuntimeError("thread not found")

    class FakeRuns:
        async def stream(self, **_kwargs):
            # Simulate LangGraph token streaming: same id, growing content.
            base = [{"id": "msg-u1", "type": "human", "content": "hello"}]
            for partial in ("Hi", "Hi there", "Hi there!"):
                yield SimpleNamespace(
                    event="values",
                    data={"messages": [*base, {"id": "msg-a1", "type": "ai", "content": partial}]},
                )

    class FakeAsyncClient:
        def __init__(self):
            self.threads = FakeThreads()
            self.runs = FakeRuns()

        async def aclose(self):
            return None

    class FakeRemoteService:
        def get_remote_agent(self, _remote_agent_id):
            return SimpleNamespace(assistant_id="assistant-1")

        def get_async_client(self, _remote_agent):
            return FakeAsyncClient()

    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: FakeRemoteService())

    events = asyncio.run(
        _collect_events(
            service._stream_remote_chat_events(
                agent_id="remote:1:assistant-1",
                remote_agent_id=1,
                assistant_id_override="assistant-1",
                conversation_id="conversation",
                messages=[],
                message="hello",
            )
        )
    )

    delta_events = [e for e in events if e["type"] == "message.delta"]
    # Only incremental suffixes should be emitted, not repeated full content.
    assert [e["delta"] for e in delta_events] == ["Hi", " there", "!"]
    complete = next(e for e in events if e["type"] == "message.complete")
    assert complete["content"] == "Hi there!"


def test_stream_remote_chat_events_emits_incremental_deltas_without_ids(monkeypatch):
    """Anonymous assistant snapshots still emit only the new suffix."""
    service = ChatService(DummyAgentService())

    history = [
        SimpleNamespace(role="user", content="old user"),
        SimpleNamespace(role="assistant", content="old assistant"),
    ]
    prior_msgs = [
        {"id": "msg-1", "type": "human", "content": "old user"},
        {"id": "msg-2", "type": "ai", "content": "old assistant"},
    ]

    class FakeThreads:
        async def get_state(self, _thread_id):
            return {"values": {"messages": prior_msgs}}

    class FakeRuns:
        async def stream(self, **_kwargs):
            for partial in ("Hi", "Hi there", "Hi there!"):
                yield SimpleNamespace(
                    event="values",
                    data={
                        "messages": [
                            {"type": "human", "content": "old user"},
                            {"type": "ai", "content": "old assistant"},
                            {"type": "human", "content": "latest question"},
                            {"type": "ai", "content": partial},
                        ]
                    },
                )

    class FakeAsyncClient:
        def __init__(self):
            self.threads = FakeThreads()
            self.runs = FakeRuns()

        async def aclose(self):
            return None

    class FakeRemoteService:
        def get_remote_agent(self, _remote_agent_id):
            return SimpleNamespace(assistant_id="assistant-1")

        def get_async_client(self, _remote_agent):
            return FakeAsyncClient()

    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: FakeRemoteService())

    events = asyncio.run(
        _collect_events(
            service._stream_remote_chat_events(
                agent_id="remote:1:assistant-1",
                remote_agent_id=1,
                assistant_id_override="assistant-1",
                conversation_id="conversation",
                messages=history,
                message="latest question",
            )
        )
    )

    delta_events = [event for event in events if event["type"] == "message.delta"]
    assert [event["delta"] for event in delta_events] == ["Hi", " there", "!"]
    assert events[-1]["type"] == "message.complete"
    assert events[-1]["content"] == "Hi there!"


def test_stream_remote_chat_events_handles_new_thread_get_state_failure(monkeypatch):
    """When get_state raises (new thread), streaming still proceeds correctly."""
    service = ChatService(DummyAgentService())

    class FakeThreads:
        async def get_state(self, _thread_id):
            raise RuntimeError("not found")

    class FakeRuns:
        async def stream(self, **_kwargs):
            yield SimpleNamespace(
                event="values",
                data={
                    "messages": [
                        {"id": "msg-u1", "type": "human", "content": "hi"},
                        {"id": "msg-a1", "type": "ai", "content": "hello back"},
                    ]
                },
            )

    class FakeAsyncClient:
        def __init__(self):
            self.threads = FakeThreads()
            self.runs = FakeRuns()

        async def aclose(self):
            return None

    class FakeRemoteService:
        def get_remote_agent(self, _remote_agent_id):
            return SimpleNamespace(assistant_id="assistant-1")

        def get_async_client(self, _remote_agent):
            return FakeAsyncClient()

    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: FakeRemoteService())

    events = asyncio.run(
        _collect_events(
            service._stream_remote_chat_events(
                agent_id="remote:1:assistant-1",
                remote_agent_id=1,
                assistant_id_override="assistant-1",
                conversation_id="conversation",
                messages=[],
                message="hi",
            )
        )
    )

    assert [e["type"] for e in events] == ["message.start", "message.delta", "message.complete"]
    assert events[1]["delta"] == "hello back"


def test_extract_message_text_ignores_user_messages():
    service = ChatService(DummyAgentService())

    assert service._extract_message_text({"role": "user", "content": "hello"}) == ""
    assert service._extract_message_text({"type": "human", "content": "hello"}) == ""


class FakeA2AClient:
    def __init__(self, responses):
        self.responses = responses
        self.requests = []
        self.closed = False

    async def send_message(self, request):
        self.requests.append(request)
        for response in self.responses:
            yield response

    async def close(self):
        self.closed = True


class FakeA2ARemoteService:
    def __init__(self, clients):
        self.clients = list(clients)

    def get_remote_agent(self, _remote_agent_server_id):
        return SimpleNamespace(protocol="a2a")

    def get_discovered_remote_agent(self, _remote_agent_server_id, _remote_agent_id):
        return SimpleNamespace(protocol="a2a", assistant_metadata={})

    async def get_a2a_client(self, _remote_agent, _discovered_agent):
        return self.clients.pop(0)


def test_stream_a2a_agent_events_supports_conversation_context(monkeypatch):
    service = ChatService(DummyAgentService())
    first_client = FakeA2AClient(
        [
            StreamResponse(
                message=new_text_message(
                    "First reply",
                    context_id="remote-context",
                    role=Role.ROLE_AGENT,
                )
            )
        ]
    )
    second_client = FakeA2AClient(
        [
            StreamResponse(
                message=new_text_message(
                    "Second reply",
                    context_id="remote-context",
                    role=Role.ROLE_AGENT,
                )
            )
        ]
    )
    remote_service = FakeA2ARemoteService([first_client, second_client])
    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: remote_service)

    first_events = asyncio.run(
        _collect_events(
            service.stream_remote_agent_events(
                remote_sender_id="remote:7:agent-card",
                remote_agent_server_id=7,
                remote_agent_id="agent-card",
                conversation_id="conversation",
                messages=[],
                message="First question",
            )
        )
    )
    second_events = asyncio.run(
        _collect_events(
            service.stream_remote_agent_events(
                remote_sender_id="remote:7:agent-card",
                remote_agent_server_id=7,
                remote_agent_id="agent-card",
                conversation_id="conversation",
                messages=[],
                message="Follow-up question",
            )
        )
    )

    assert [event["type"] for event in first_events] == [
        "message.start",
        "message.delta",
        "message.complete",
    ]
    assert first_events[1]["delta"] == "First reply"
    assert second_events[1]["delta"] == "Second reply"
    assert get_message_text(first_client.requests[0].message) == "First question"
    assert second_client.requests[0].message.context_id == "remote-context"
    assert first_client.closed
    assert second_client.closed


def test_stream_a2a_agent_events_normalizes_artifact_chunks(monkeypatch):
    service = ChatService(DummyAgentService())
    client = FakeA2AClient(
        [
            StreamResponse(
                artifact_update=new_text_artifact_update_event(
                    task_id="task-1",
                    context_id="context-1",
                    name="answer",
                    text="Hel",
                    artifact_id="artifact-1",
                )
            ),
            StreamResponse(
                artifact_update=new_text_artifact_update_event(
                    task_id="task-1",
                    context_id="context-1",
                    name="answer",
                    text="lo",
                    append=True,
                    last_chunk=True,
                    artifact_id="artifact-1",
                )
            ),
        ]
    )
    remote_service = FakeA2ARemoteService([client])
    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: remote_service)

    events = asyncio.run(
        _collect_events(
            service.stream_remote_agent_events(
                remote_sender_id="remote:7:agent-card",
                remote_agent_server_id=7,
                remote_agent_id="agent-card",
                conversation_id="conversation",
                messages=[],
                message="Hello",
            )
        )
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "message.delta",
        "message.delta",
        "message.complete",
    ]
    assert [events[1]["delta"], events[2]["delta"]] == ["Hel", "lo"]
    assert events[3]["content"] == "Hello"


def test_stream_a2a_agent_events_exposes_structured_tool_calls(monkeypatch):
    service = ChatService(DummyAgentService())
    tool_call = {
        "tool_calls": [
            {
                "id": "call-1",
                "function": {
                    "name": "get_weather",
                    "arguments": {"city": "Oak Ridge"},
                },
            }
        ]
    }
    client = FakeA2AClient(
        [
            StreamResponse(message=new_data_message(tool_call, context_id="context-1")),
            # A2A streams may repeat snapshots; the call should render once.
            StreamResponse(message=new_data_message(tool_call, context_id="context-1")),
            StreamResponse(
                artifact_update=new_data_artifact_update_event(
                    task_id="task-1",
                    context_id="context-1",
                    name="tool-output",
                    data={
                        "functionResponse": {
                            "id": "call-1",
                            "name": "get_weather",
                            "response": {"temperature": 72, "unit": "F"},
                        }
                    },
                    artifact_id="artifact-1",
                    last_chunk=True,
                )
            ),
        ]
    )
    remote_service = FakeA2ARemoteService([client])
    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: remote_service)

    events = asyncio.run(
        _collect_events(
            service.stream_remote_agent_events(
                remote_sender_id="remote:7:agent-card",
                remote_agent_server_id=7,
                remote_agent_id="agent-card",
                conversation_id="conversation",
                messages=[],
                message="What is the weather?",
            )
        )
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "tool.start",
        "tool.progress",
        "tool.progress",
        "tool.result",
        "message.complete",
    ]
    assert events[1] == {
        "type": "tool.start",
        "conversationId": "conversation",
        "messageId": events[0]["messageId"],
        "toolCallId": "call-1",
        "toolName": "get_weather",
        "input": {"city": "Oak Ridge"},
        "timestamp": events[1]["timestamp"],
    }
    assert events[4]["result"] == {"temperature": 72.0, "unit": "F"}
    assert events[5]["content"] == ""


def test_clear_a2a_conversation_forgets_remote_context(monkeypatch):
    service = ChatService(DummyAgentService())
    remote_service = FakeA2ARemoteService([])
    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: remote_service)
    chat_module.a2a_context_cache["7:conversation"] = "remote-context"

    service.clear_remote_agent_conversation(7, "conversation")

    assert "7:conversation" not in chat_module.a2a_context_cache


class FakeAGUIResponse:
    def __init__(self, events):
        self.events = events

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def raise_for_status(self):
        return None

    async def aiter_lines(self):
        for event in self.events:
            yield f"data: {event}"
            yield ""


class FakeAGUIClient:
    def __init__(self, events):
        self.events = events
        self.request = None
        self.closed = False

    def stream(self, method, url, *, json, headers):
        self.request = {
            "method": method,
            "url": url,
            "json": json,
            "headers": headers,
        }
        return FakeAGUIResponse(self.events)

    async def aclose(self):
        self.closed = True


class FakeAGUIRemoteService:
    def __init__(self, client):
        self.client = client

    def get_remote_agent(self, _remote_agent_server_id):
        return SimpleNamespace(protocol="agui", url="https://agent.example.com/agui")

    def get_discovered_remote_agent(self, _remote_agent_server_id, _remote_agent_id):
        return SimpleNamespace(protocol="agui", assistant_metadata={})

    def get_agui_client(self, _remote_agent):
        return self.client


def test_stream_agui_agent_events_maps_text_and_tool_events(monkeypatch):
    service = ChatService(DummyAgentService())
    client = FakeAGUIClient(
        [
            '{"type":"RUN_STARTED","threadId":"thread-1","runId":"run-1"}',
            '{"type":"TOOL_CALL_START","toolCallId":"call-1",'
            '"toolCallName":"get_weather","parentMessageId":"message-1"}',
            '{"type":"TOOL_CALL_ARGS","toolCallId":"call-1","delta":"{\\"city\\":\\"Oak "}',
            '{"type":"TOOL_CALL_ARGS","toolCallId":"call-1","delta":"Ridge\\"}"}',
            '{"type":"TOOL_CALL_END","toolCallId":"call-1"}',
            '{"type":"TOOL_CALL_RESULT","messageId":"tool-message-1",'
            '"toolCallId":"call-1","content":"{\\"temperature\\":72}"}',
            '{"type":"TEXT_MESSAGE_START","messageId":"message-1","role":"assistant"}',
            '{"type":"TEXT_MESSAGE_CONTENT","messageId":"message-1","delta":"It is 72 F."}',
            '{"type":"TEXT_MESSAGE_END","messageId":"message-1"}',
            '{"type":"RUN_FINISHED","threadId":"thread-1","runId":"run-1"}',
        ]
    )
    remote_service = FakeAGUIRemoteService(client)
    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: remote_service)

    events = asyncio.run(
        _collect_events(
            service.stream_remote_agent_events(
                remote_sender_id="remote:7:ag-ui-endpoint",
                remote_agent_server_id=7,
                remote_agent_id="ag-ui-endpoint",
                conversation_id="conversation",
                messages=[SimpleNamespace(role="assistant", content="Previous answer")],
                message="What is the weather?",
            )
        )
    )

    assert [event["type"] for event in events] == [
        "message.start",
        "tool.start",
        "tool.progress",
        "tool.progress",
        "tool.progress",
        "tool.result",
        "message.delta",
        "message.complete",
    ]
    assert events[1]["toolName"] == "get_weather"
    assert events[3]["detail"] == 'Arguments: {"city": "Oak Ridge"}'
    assert events[5]["result"] == {"temperature": 72}
    assert events[6]["delta"] == "It is 72 F."
    assert events[7]["content"] == "It is 72 F."
    assert client.request["method"] == "POST"
    assert client.request["json"]["forwardedProps"] == {"agentId": "ag-ui-endpoint"}
    assert [message["role"] for message in client.request["json"]["messages"]] == [
        "assistant",
        "user",
    ]
    assert client.closed


def test_clear_agui_conversation_allocates_a_new_thread(monkeypatch):
    service = ChatService(DummyAgentService())
    remote_service = FakeAGUIRemoteService(FakeAGUIClient([]))
    monkeypatch.setattr(service, "_require_remote_agent_service", lambda: remote_service)
    chat_module.agui_thread_cache["7:conversation"] = "thread-1"

    service.clear_remote_agent_conversation(7, "conversation")

    assert "7:conversation" not in chat_module.agui_thread_cache
