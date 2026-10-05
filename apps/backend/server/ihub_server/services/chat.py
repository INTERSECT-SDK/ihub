"""Chat service for agent conversations using LangChain graphs."""

from __future__ import annotations

import asyncio
import base64
import binascii
import io
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, cast
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from a2a.helpers.proto_helpers import (
    get_data_parts,
    get_message_text,
    get_stream_response_text,
    new_message,
    new_raw_part,
    new_text_part,
)
from a2a.types import Role, SendMessageRequest, StreamResponse
from ag_ui.core import Event as AGUIEvent
from ag_ui.core import RunAgentInput
from google.protobuf.json_format import MessageToDict
from pydantic import TypeAdapter, ValidationError
from pypdf import PdfReader

from ihub_server.agent_utils.agent_factory import AgentFactory
from ihub_server.agent_utils.memory_store import MemoryStore
from ihub_server.agent_utils.tool_registry import ToolRegistry
from ihub_server.services.errors import ServiceError

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from ihub_server.services.agents import AgentService
    from ihub_server.services.remote_agent_servers import RemoteAgentServerService

_log = logging.getLogger("ihub-server")

tool_registry = ToolRegistry()
memory_store = MemoryStore()
agent_factory = AgentFactory(tool_registry=tool_registry, memory_store=memory_store)

graph_cache: dict[str, Any] = {}
a2a_context_cache: dict[str, str] = {}
agui_thread_cache: dict[str, str] = {}

agui_event_adapter: TypeAdapter[AGUIEvent] = TypeAdapter(AGUIEvent)

MAX_EXTRACTED_ATTACHMENT_CHARS = 1_000_000
MAX_GROUP_PARTICIPANTS = 8


@dataclass(frozen=True)
class _GroupParticipant:
    selector_id: str
    name: str
    local_agent_id: UUID | None = None
    remote_agent_server_id: int | None = None
    remote_agent_id: str | None = None


@dataclass(frozen=True)
class _GroupPlan:
    action: str
    participants: tuple[_GroupParticipant, ...] = ()
    response_mode: str = "supervisor"
    task: str = ""


@dataclass
class _GroupReport:
    content: str = ""
    streamed_content: str = ""
    failed: bool = False


@dataclass
class _AGUIStreamState:
    conversation_id: str
    assistant_message_id: str
    remote_sender_id: str
    aggregated_content: str = ""
    started: bool = False
    failed: bool = False
    run_result: Any = None
    message_roles: dict[str, str] = field(default_factory=dict)
    tool_names: dict[str, str] = field(default_factory=dict)
    tool_args: dict[str, str] = field(default_factory=dict)
    started_tools: set[str] = field(default_factory=set)
    active_tool_call_id: str | None = None


class ChatService:
    def __init__(
        self,
        agent_service: AgentService,
        remote_agent_service: RemoteAgentServerService | None = None,
    ) -> None:
        self._agent_service = agent_service
        self._remote_agent_service = remote_agent_service

    def _require_remote_agent_service(self) -> RemoteAgentServerService:
        if self._remote_agent_service is None:
            msg = "Remote agent service is not configured."
            raise ServiceError(msg)
        return self._remote_agent_service

    def chat(
        self,
        agent_id: UUID,
        conversation_id: str,
        messages: list[Any],
        message: str,
        supervisor_agent_id: str | None = None,
        participant_agent_ids: list[str] | None = None,
        attachments: list[Any] | None = None,
    ) -> str:
        agent_def = self._agent_service.get_agent(agent_id)

        runtime_overrides = self._build_runtime_overrides(
            supervisor_agent_id,
            participant_agent_ids,
        )
        graph = self._get_or_build_graph(
            agent_id,
            conversation_id,
            agent_def,
            runtime_overrides,
        )

        try:
            messages_history = self._build_messages_history(messages, message, attachments)

            _log.info(
                "Invoking graph with %s messages (history + new)",
                len(messages_history),
            )

            response = graph.invoke({"messages": messages_history})
            messages_out = response.get("messages", [])
            if not messages_out:
                return ""
            last_message = messages_out[-1]
            if hasattr(last_message, "content"):
                return last_message.content
            if isinstance(last_message, dict):
                return last_message.get("content", "")
            return str(last_message)
        except Exception as exc:
            _log.error("Failed to invoke agent: %s", exc, exc_info=True)
            msg = f"Agent invocation failed: {exc!s}"
            raise ServiceError(msg) from exc

    async def stream_chat_events(
        self,
        agent_id: UUID,
        conversation_id: str,
        messages: list[Any],
        message: str,
        supervisor_agent_id: str | None = None,
        participant_agent_ids: list[str] | None = None,
        attachments: list[Any] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        agent_def = self._agent_service.get_agent(agent_id)

        if participant_agent_ids and self._content_value(agent_def, "graph_type") == "supervisor":
            async for event in self._stream_mixed_group_events(
                supervisor_agent_id=agent_id,
                supervisor_agent_def=agent_def,
                conversation_id=conversation_id,
                messages=messages,
                message=message,
                participant_agent_ids=participant_agent_ids or [],
                attachments=attachments,
            ):
                yield event
            return

        runtime_overrides = self._build_runtime_overrides(
            supervisor_agent_id,
            participant_agent_ids,
        )
        assistant_message_id = f"assistant-{uuid4().hex}"
        aggregated_content = ""
        started = False
        completed = False

        try:
            agent_def = self._agent_service.get_agent(agent_id)

            runtime_overrides = self._build_runtime_overrides(
                supervisor_agent_id,
                participant_agent_ids,
            )

            graph = self._get_or_build_graph(
                agent_id,
                conversation_id,
                agent_def,
                runtime_overrides,
            )

            messages_history = self._build_messages_history(messages, message, attachments)
            seen_message_count = len(messages_history)

            if hasattr(graph, "astream"):
                _log.info(
                    "Streaming graph updates for %s with %s messages",
                    conversation_id,
                    len(messages_history),
                )
                async for state in graph.astream(
                    {"messages": messages_history},
                    stream_mode="values",
                ):
                    graph_messages = self._extract_graph_messages(state)
                    if len(graph_messages) <= seen_message_count:
                        continue

                    new_messages = graph_messages[seen_message_count:]
                    seen_message_count = len(graph_messages)

                    for event in self._events_from_graph_messages(
                        conversation_id=conversation_id,
                        assistant_message_id=assistant_message_id,
                        sender_id=str(agent_id),
                        graph_messages=new_messages,
                    ):
                        if event["type"] == "message.start":
                            if started:
                                continue
                            started = True
                        elif event["type"] == "message.delta":
                            aggregated_content += cast(str, event["delta"])
                        yield event

                if started:
                    completed = True
                    yield {
                        "type": "message.complete",
                        "conversationId": conversation_id,
                        "messageId": assistant_message_id,
                        "content": aggregated_content,
                    }
                    return

            if attachments is None:
                response_text = self.chat(
                    agent_id,
                    conversation_id,
                    messages,
                    message,
                    supervisor_agent_id,
                    participant_agent_ids,
                )
            else:
                response_text = self.chat(
                    agent_id,
                    conversation_id,
                    messages,
                    message,
                    supervisor_agent_id,
                    participant_agent_ids,
                    attachments,
                )

            if not started:
                yield self._message_start_event(
                    conversation_id,
                    assistant_message_id,
                    str(agent_id),
                )
            yield {
                "type": "message.delta",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "delta": response_text,
            }
            yield {
                "type": "message.complete",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "content": response_text,
            }
        except Exception as exc:  # noqa: BLE001
            _log.error("Failed to stream chat events: %s", exc, exc_info=True)
            if started and not completed:
                yield {
                    "type": "message.complete",
                    "conversationId": conversation_id,
                    "messageId": assistant_message_id,
                    "content": aggregated_content,
                }
            yield {
                "type": "error",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "error": f"Agent invocation failed: {exc!s}",
            }

    async def _stream_mixed_group_events(
        self,
        *,
        supervisor_agent_id: UUID,
        supervisor_agent_def: Any,
        conversation_id: str,
        messages: list[Any],
        message: str,
        participant_agent_ids: list[str],
        attachments: list[Any] | None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Run one bounded participant round, then let the local lead synthesize."""
        if self._content_value(supervisor_agent_def, "graph_type") != "supervisor":
            yield self._group_error_event(
                conversation_id,
                "Mixed group chat requires a local supervisor agent as the lead.",
            )
            return
        try:
            participants = self._resolve_group_participants(
                supervisor_agent_id,
                participant_agent_ids,
            )
        except (ServiceError, ValueError) as exc:
            yield self._group_error_event(conversation_id, str(exc))
            return

        supervisor_name = str(self._content_value(supervisor_agent_def, "name") or "Supervisor")
        plan = await self._plan_group_turn(
            supervisor_agent_id=supervisor_agent_id,
            supervisor_name=supervisor_name,
            conversation_id=conversation_id,
            messages=messages,
            message=message,
            attachments=attachments,
            participants=participants,
        )

        if plan.action == "direct":
            async for event in self.stream_chat_events(
                supervisor_agent_id,
                self._group_supervisor_conversation_id(conversation_id),
                messages,
                message,
                attachments=attachments,
            ):
                remapped_event = dict(event)
                remapped_event["conversationId"] = conversation_id
                yield remapped_event
            return

        reports: list[tuple[_GroupParticipant, str]] = []
        show_participant_messages = plan.response_mode == "participant_only"

        for participant in plan.participants:
            participant_prompt = self._build_group_participant_prompt(
                supervisor_name=supervisor_name,
                user_message=message,
                delegated_task=plan.task,
            )
            report = _GroupReport()
            buffered_events: list[dict[str, Any]] = []
            async for event in self._stream_group_participant_events(
                participant=participant,
                conversation_id=conversation_id,
                messages=messages,
                participant_prompt=participant_prompt,
                attachments=attachments,
                report=report,
            ):
                if show_participant_messages:
                    yield event
                else:
                    buffered_events.append(event)

            content = report.content or report.streamed_content
            if report.failed and not content:
                content = "Participant invocation failed; no report was returned."
            reports.append((participant, content))

            if not show_participant_messages:
                for event in self._visible_internal_participant_events(buffered_events):
                    yield event

        if plan.response_mode == "participant_only":
            return

        synthesis_prompt = self._build_group_synthesis_prompt(message, reports)
        async for event in self.stream_chat_events(
            supervisor_agent_id,
            self._group_supervisor_conversation_id(conversation_id),
            messages,
            synthesis_prompt,
        ):
            remapped_event = dict(event)
            remapped_event["conversationId"] = conversation_id
            yield remapped_event

    async def _stream_group_participant_events(
        self,
        *,
        participant: _GroupParticipant,
        conversation_id: str,
        messages: list[Any],
        participant_prompt: str,
        attachments: list[Any] | None,
        report: _GroupReport,
    ) -> AsyncIterator[dict[str, Any]]:
        participant_conversation_id = self._group_participant_conversation_id(
            conversation_id,
            participant.selector_id,
        )
        if participant.local_agent_id is not None:
            event_stream = self.stream_chat_events(
                participant.local_agent_id,
                participant_conversation_id,
                messages,
                participant_prompt,
                attachments=attachments,
            )
        else:
            if participant.remote_agent_server_id is None or participant.remote_agent_id is None:
                return
            event_stream = self.stream_remote_agent_events(
                remote_sender_id=participant.selector_id,
                remote_agent_server_id=participant.remote_agent_server_id,
                remote_agent_id=participant.remote_agent_id,
                conversation_id=participant_conversation_id,
                messages=messages,
                message=participant_prompt,
                attachments=attachments,
            )

        started_message_ids: set[str] = set()
        try:
            async for participant_event in event_stream:
                event = dict(participant_event)
                event["conversationId"] = conversation_id
                message_id = str(event.get("messageId") or "")
                if event.get("type") == "message.start":
                    started_message_ids.add(message_id)
                elif event.get("type") == "message.complete":
                    report.content = str(event.get("content") or report.content)
                elif event.get("type") == "message.delta":
                    report.streamed_content += str(event.get("delta") or "")
                elif event.get("type") == "error":
                    report.failed = True
                    if message_id and message_id not in started_message_ids:
                        started_message_ids.add(message_id)
                        yield self._message_start_event(
                            conversation_id,
                            message_id,
                            participant.selector_id,
                        )
                yield event
        except Exception as exc:  # noqa: BLE001
            report.failed = True
            failure_message_id = f"assistant-{uuid4().hex}"
            _log.error(
                "Group participant %s failed: %s",
                participant.selector_id,
                exc,
                exc_info=True,
            )
            yield self._message_start_event(
                conversation_id,
                failure_message_id,
                participant.selector_id,
            )
            yield {
                "type": "error",
                "conversationId": conversation_id,
                "messageId": failure_message_id,
                "error": f"Participant invocation failed: {exc!s}",
            }

    async def _plan_group_turn(
        self,
        *,
        supervisor_agent_id: UUID,
        supervisor_name: str,
        conversation_id: str,
        messages: list[Any],
        message: str,
        attachments: list[Any] | None,
        participants: list[_GroupParticipant],
    ) -> _GroupPlan:
        if self._mentions_group_supervisor(message, supervisor_name):
            return _GroupPlan(action="direct")

        mentioned_participant = self._mentioned_group_participant(message, participants)
        if mentioned_participant is not None:
            return _GroupPlan(
                action="delegate",
                participants=(mentioned_participant,),
                response_mode="participant_only",
                task=message,
            )

        planning_prompt = self._build_group_planning_prompt(
            user_message=message,
            messages=messages,
            supervisor_agent_id=supervisor_agent_id,
            supervisor_name=supervisor_name,
            participants=participants,
        )
        try:
            raw_plan = await asyncio.to_thread(
                self.chat,
                supervisor_agent_id,
                self._group_planning_conversation_id(conversation_id),
                [],
                planning_prompt,
                attachments=attachments,
            )
        except ServiceError as exc:
            _log.warning("Supervisor planning failed; answering directly: %s", exc)
            return _GroupPlan(action="direct")

        return self._normalize_group_plan(raw_plan, message, participants)

    def _normalize_group_plan(
        self,
        raw_plan: Any,
        user_message: str,
        participants: list[_GroupParticipant],
    ) -> _GroupPlan:
        parsed = (
            raw_plan if isinstance(raw_plan, dict) else self._parse_json_like_text(str(raw_plan))
        )
        if not isinstance(parsed, dict):
            _log.warning("Supervisor returned an invalid group plan; answering directly")
            return _GroupPlan(action="direct")

        action = str(parsed.get("action") or "").strip().lower()
        if action != "delegate":
            return _GroupPlan(action="direct")

        requested_ids = parsed.get("participantIds", parsed.get("participant_ids", []))
        if not isinstance(requested_ids, list):
            return _GroupPlan(action="direct")

        by_selector = {participant.selector_id: participant for participant in participants}
        by_name = {participant.name.casefold(): participant for participant in participants}
        selected: list[_GroupParticipant] = []
        for requested_id in requested_ids:
            identifier = str(requested_id).strip()
            participant = by_selector.get(identifier) or by_name.get(identifier.casefold())
            if participant is not None and participant not in selected:
                selected.append(participant)

        if not selected:
            return _GroupPlan(action="direct")

        requested_mode = str(parsed.get("responseMode", parsed.get("response_mode", ""))).lower()
        response_mode = (
            "participant_only"
            if len(selected) == 1 and requested_mode != "synthesize"
            else "synthesize"
        )
        task = str(parsed.get("task") or user_message).strip() or user_message
        return _GroupPlan(
            action="delegate",
            participants=tuple(selected),
            response_mode=response_mode,
            task=task,
        )

    def _resolve_group_participants(
        self,
        supervisor_agent_id: UUID,
        participant_agent_ids: list[str],
    ) -> list[_GroupParticipant]:
        if len(participant_agent_ids) > MAX_GROUP_PARTICIPANTS:
            msg = f"Group chat supports up to {MAX_GROUP_PARTICIPANTS} participants."
            raise ServiceError(msg)

        participants: list[_GroupParticipant] = []
        seen: set[str] = set()
        for selector_id in participant_agent_ids:
            if selector_id in seen:
                continue
            seen.add(selector_id)

            if selector_id.startswith("remote:"):
                remote_agent_service = self._require_remote_agent_service()
                remote_agent_server_id, remote_agent_id = self._parse_remote_selector(selector_id)
                discovered = remote_agent_service.get_discovered_remote_agent(
                    remote_agent_server_id,
                    remote_agent_id,
                )
                participants.append(
                    _GroupParticipant(
                        selector_id=selector_id,
                        name=discovered.name,
                        remote_agent_server_id=remote_agent_server_id,
                        remote_agent_id=remote_agent_id,
                    )
                )
                continue

            try:
                local_agent_id = UUID(selector_id)
            except ValueError as exc:
                msg = f"Invalid group participant identifier: {selector_id}"
                raise ServiceError(msg) from exc
            if local_agent_id == supervisor_agent_id:
                continue
            local_agent = self._agent_service.get_agent(local_agent_id)
            participants.append(
                _GroupParticipant(
                    selector_id=str(local_agent_id),
                    name=str(self._content_value(local_agent, "name") or "Local agent"),
                    local_agent_id=local_agent_id,
                )
            )

        if not participants:
            msg = "Mixed group chat requires at least one participant."
            raise ServiceError(msg)
        return participants

    @staticmethod
    def _has_remote_participant(participant_agent_ids: list[str] | None) -> bool:
        return any(
            participant_id.startswith("remote:") for participant_id in participant_agent_ids or []
        )

    @staticmethod
    def _parse_remote_selector(selector_id: str) -> tuple[int, str]:
        parts = selector_id.split(":", 2)
        if len(parts) != 3 or not parts[2]:
            msg = f"Invalid remote participant identifier: {selector_id}"
            raise ServiceError(msg)
        try:
            remote_agent_server_id = int(parts[1])
        except ValueError as exc:
            msg = f"Invalid remote participant identifier: {selector_id}"
            raise ServiceError(msg) from exc
        return remote_agent_server_id, parts[2]

    @staticmethod
    def _group_participant_conversation_id(
        conversation_id: str,
        participant_id: str,
    ) -> str:
        participant_key = uuid5(NAMESPACE_URL, participant_id).hex
        return f"{conversation_id}:participant:{participant_key}"

    @staticmethod
    def _group_supervisor_conversation_id(conversation_id: str) -> str:
        return f"{conversation_id}:supervisor"

    @staticmethod
    def _group_planning_conversation_id(conversation_id: str) -> str:
        return f"{conversation_id}:planning"

    @classmethod
    def _mentions_group_supervisor(cls, message: str, supervisor_name: str) -> bool:
        candidates = {"supervisor", "lead", supervisor_name.casefold()}
        return any(cls._has_leading_mention(message, candidate) for candidate in candidates)

    @staticmethod
    def _has_leading_mention(message: str, candidate: str) -> bool:
        mention_text = message.lstrip()
        if not mention_text.startswith("@"):
            return False
        remainder = mention_text[1:].casefold()
        candidate = candidate.casefold().strip()
        if not candidate or not remainder.startswith(candidate):
            return False
        suffix = remainder[len(candidate) :]
        return not suffix or suffix[0].isspace() or suffix[0] in ":,.;!?)]}"

    @staticmethod
    def _mentioned_group_participant(
        message: str,
        participants: list[_GroupParticipant],
    ) -> _GroupParticipant | None:
        for participant in sorted(participants, key=lambda item: len(item.name), reverse=True):
            if ChatService._has_leading_mention(message, participant.name):
                return participant
        return None

    def _build_group_planning_prompt(
        self,
        *,
        user_message: str,
        messages: list[Any],
        supervisor_agent_id: UUID,
        supervisor_name: str,
        participants: list[_GroupParticipant],
    ) -> str:
        roster = "\n".join(
            f'- id: "{participant.selector_id}"; name: "{participant.name}"'
            for participant in participants
        )
        recent_history = self._group_planning_history(
            messages,
            supervisor_agent_id,
            supervisor_name,
            participants,
        )
        return (
            "Act only as the routing controller for this group-chat turn. Treat every "
            "turn as a fresh routing decision; a participant that answered previously "
            "does not own future turns. Direct is the default. Delegate only when a "
            "participant's specialty materially improves the answer. Requests addressed "
            "to you, the lead, or the supervisor must use direct. General conversation "
            "and simple follow-ups should also use direct.\n\n"
            "Return one JSON object and no other text. Valid shapes:\n"
            '{"action":"direct"}\n'
            '{"action":"delegate","participantIds":["exact roster id"],'
            '"responseMode":"participant_only","task":"focused assignment"}\n'
            "Use participant_only for one authoritative worker. Use synthesize only "
            "when two or more independent reports genuinely need reconciliation.\n\n"
            f"Lead supervisor: {supervisor_name} ({supervisor_agent_id})\n"
            f"Available participants:\n{roster}\n\n"
            f"Recent attributed conversation:\n{recent_history}\n\n"
            f"Current user message:\n{user_message}"
        )

    def _group_planning_history(
        self,
        messages: list[Any],
        supervisor_agent_id: UUID,
        supervisor_name: str,
        participants: list[_GroupParticipant],
    ) -> str:
        participant_names = {
            participant.selector_id: participant.name for participant in participants
        }
        lines: list[str] = []
        for history_message in messages[-8:]:
            role = str(self._content_value(history_message, "role") or "unknown")
            sender_id = str(self._content_value(history_message, "sender_id", "senderId") or "")
            if role == "user":
                speaker = "User"
            elif sender_id == str(supervisor_agent_id):
                speaker = f"Supervisor {supervisor_name}"
            else:
                speaker = participant_names.get(sender_id, "Assistant (unattributed)")
            content = self._group_planning_history_text(
                self._content_value(history_message, "content")
            )
            if content:
                lines.append(f"{speaker}: {content[:500]}")
        return "\n".join(lines) or "[No prior messages]"

    def _group_planning_history_text(self, content: Any) -> str:
        if isinstance(content, str):
            return content.strip()
        if not isinstance(content, list):
            return str(content).strip()
        text_parts = [
            str(self._content_value(block, "text") or "")
            for block in content
            if self._content_value(block, "type") == "text"
        ]
        return " ".join(part.strip() for part in text_parts if part.strip())

    @staticmethod
    def _visible_internal_participant_events(
        events: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Expose internal tool activity and errors without rendering report text."""
        visible_types = {"tool.start", "tool.progress", "tool.result", "error"}
        visible_message_ids = {
            str(event.get("messageId") or "")
            for event in events
            if event.get("type") in visible_types
        }
        visible_events: list[dict[str, Any]] = []
        for event in events:
            event_type = event.get("type")
            message_id = str(event.get("messageId") or "")
            if event_type in visible_types or (
                event_type == "message.start" and message_id in visible_message_ids
            ):
                visible_events.append(event)
            elif event_type == "message.complete" and message_id in visible_message_ids:
                completed_event = dict(event)
                completed_event["content"] = ""
                visible_events.append(completed_event)
        return visible_events

    @staticmethod
    def _build_group_participant_prompt(
        *,
        supervisor_name: str,
        user_message: str,
        delegated_task: str,
    ) -> str:
        return (
            f'You are a participant in a group chat led by "{supervisor_name}". '
            "Address the user's request from your own specialty. Return a concise, "
            "useful report that the lead can reconcile with other participants.\n\n"
            f"Delegated task:\n{delegated_task}\n\n"
            f"Original user request:\n{user_message}"
        )

    @staticmethod
    def _build_group_synthesis_prompt(
        user_message: str,
        reports: list[tuple[_GroupParticipant, str]],
    ) -> str:
        report_text = "\n\n".join(
            f"Participant: {participant.name} ({participant.selector_id})\n"
            f"Report:\n{content or '[No visible report returned]'}"
            for participant, content in reports
        )
        return (
            "You are the lead supervisor for this group-chat turn. Reconcile the "
            "participant reports into the final response to the user. Resolve "
            "conflicts explicitly, preserve useful attribution when relevant, and "
            "do not claim that a participant completed work absent from its report.\n\n"
            f"Original user request:\n{user_message}\n\n"
            f"Participant reports:\n{report_text}"
        )

    @staticmethod
    def _group_error_event(conversation_id: str, error: str) -> dict[str, Any]:
        return {
            "type": "error",
            "conversationId": conversation_id,
            "messageId": f"assistant-{uuid4().hex}",
            "error": error,
        }

    async def stream_remote_agent_events(
        self,
        remote_sender_id: str,
        remote_agent_server_id: int,
        remote_agent_id: str,
        conversation_id: str,
        messages: list[Any],
        message: str,
        attachments: list[Any] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream chat events directly to a discovered remote agent."""
        remote_agent_service = self._require_remote_agent_service()
        remote_agent = remote_agent_service.get_remote_agent(remote_agent_server_id)
        if remote_agent.protocol == "a2a":
            async for event in self._stream_a2a_chat_events(
                remote_sender_id=remote_sender_id,
                remote_agent_server_id=remote_agent_server_id,
                remote_agent_id=remote_agent_id,
                conversation_id=conversation_id,
                message=message,
                attachments=attachments,
            ):
                yield event
            return
        if remote_agent.protocol == "agui":
            async for event in self._stream_agui_chat_events(
                remote_sender_id=remote_sender_id,
                remote_agent_server_id=remote_agent_server_id,
                remote_agent_id=remote_agent_id,
                conversation_id=conversation_id,
                messages=messages,
                message=message,
                attachments=attachments,
            ):
                yield event
            return

        async for event in self._stream_remote_chat_events(
            agent_id=remote_sender_id,
            remote_agent_id=remote_agent_server_id,
            assistant_id_override=remote_agent_id,
            conversation_id=conversation_id,
            messages=messages,
            message=message,
            attachments=attachments,
        ):
            yield event

    def clear_remote_agent_conversation(
        self,
        remote_agent_server_id: int,
        conversation_id: str,
    ) -> None:
        """Clear a remote agent thread by remote agent server id and conversation id."""
        remote_agent_service = self._require_remote_agent_service()
        remote_agent = remote_agent_service.get_remote_agent(remote_agent_server_id)
        if remote_agent.protocol == "a2a":
            a2a_context_cache.pop(
                self._a2a_context_key(remote_agent_server_id, conversation_id),
                None,
            )
            return
        if remote_agent.protocol == "agui":
            agui_thread_cache.pop(
                self._agui_context_key(remote_agent_server_id, conversation_id),
                None,
            )
            return
        self._delete_remote_thread(remote_agent_server_id, conversation_id)

    async def _stream_agui_chat_events(
        self,
        *,
        remote_sender_id: str,
        remote_agent_server_id: int,
        remote_agent_id: str,
        conversation_id: str,
        messages: list[Any],
        message: str,
        attachments: list[Any] | None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Run an AG-UI endpoint and translate its SSE events to iHub events."""
        remote_agent_service = self._require_remote_agent_service()
        remote_agent = remote_agent_service.get_remote_agent(remote_agent_server_id)
        discovered_agent = remote_agent_service.get_discovered_remote_agent(
            remote_agent_server_id,
            remote_agent_id,
        )
        if discovered_agent.protocol != "agui":
            msg = "Discovered remote agent is not configured for AG-UI"
            raise ServiceError(msg)

        context_key = self._agui_context_key(remote_agent_server_id, conversation_id)
        thread_id = agui_thread_cache.setdefault(context_key, str(uuid4()))
        run_id = str(uuid4())
        assistant_message_id = f"assistant-{uuid4().hex}"
        request = self._build_agui_run_input(
            thread_id=thread_id,
            run_id=run_id,
            remote_agent_id=remote_agent_id,
            conversation_id=conversation_id,
            messages=messages,
            message=message,
            attachments=attachments,
        )
        client = remote_agent_service.get_agui_client(remote_agent)
        state = _AGUIStreamState(
            conversation_id=conversation_id,
            assistant_message_id=assistant_message_id,
            remote_sender_id=remote_sender_id,
        )

        try:
            async with client.stream(
                "POST",
                remote_agent.url,
                json=request,
                headers={"Content-Type": "application/json"},
            ) as response:
                response.raise_for_status()
                async for remote_event in self._iter_agui_events(response):
                    for event in self._events_from_agui_event(remote_event, state):
                        yield event

            if state.failed:
                return

            if not state.started and state.run_result is not None:
                result_text = self._agui_result_text(state.run_result)
                if result_text:
                    state.started = True
                    state.aggregated_content = result_text
                    yield self._message_start_event_from_agui(state)
                    yield {
                        "type": "message.delta",
                        "conversationId": conversation_id,
                        "messageId": assistant_message_id,
                        "delta": result_text,
                    }

            if not state.started:
                yield {
                    "type": "error",
                    "conversationId": conversation_id,
                    "messageId": assistant_message_id,
                    "error": "AG-UI agent completed without returning visible content.",
                }
                return

            yield {
                "type": "message.complete",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "content": state.aggregated_content,
            }
        except Exception as exc:  # noqa: BLE001
            _log.error("Failed to stream AG-UI chat events: %s", exc, exc_info=True)
            if state.started:
                yield {
                    "type": "message.complete",
                    "conversationId": conversation_id,
                    "messageId": assistant_message_id,
                    "content": state.aggregated_content,
                }
            yield {
                "type": "error",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "error": f"AG-UI agent invocation failed: {exc!s}",
            }
        finally:
            await client.aclose()

    def _events_from_agui_event(
        self,
        remote_event: dict[str, Any],
        state: _AGUIStreamState,
    ) -> list[dict[str, Any]]:
        event_type = str(remote_event.get("type") or "").upper()
        if event_type.startswith("TEXT_MESSAGE_"):
            return self._text_events_from_agui(event_type, remote_event, state)
        if event_type.startswith("TOOL_CALL_"):
            return self._tool_events_from_agui(event_type, remote_event, state)
        if event_type == "RUN_FINISHED":
            state.run_result = remote_event.get("result")
            return []
        if event_type == "RUN_ERROR":
            state.failed = True
            return [
                {
                    "type": "error",
                    "conversationId": state.conversation_id,
                    "messageId": state.assistant_message_id,
                    "error": str(remote_event.get("message") or "AG-UI agent run failed."),
                }
            ]
        return []

    def _text_events_from_agui(
        self,
        event_type: str,
        remote_event: dict[str, Any],
        state: _AGUIStreamState,
    ) -> list[dict[str, Any]]:
        remote_message_id = str(remote_event.get("messageId") or "")
        if event_type == "TEXT_MESSAGE_START":
            state.message_roles[remote_message_id] = str(remote_event.get("role") or "assistant")
            return []
        if event_type not in {"TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CHUNK"}:
            return []

        role = str(
            remote_event.get("role") or state.message_roles.get(remote_message_id) or "assistant"
        )
        delta = remote_event.get("delta")
        if role != "assistant" or not isinstance(delta, str) or not delta:
            return []
        events = self._start_agui_message(state)
        state.aggregated_content += delta
        events.append(
            {
                "type": "message.delta",
                "conversationId": state.conversation_id,
                "messageId": state.assistant_message_id,
                "delta": delta,
            }
        )
        return events

    def _tool_events_from_agui(
        self,
        event_type: str,
        remote_event: dict[str, Any],
        state: _AGUIStreamState,
    ) -> list[dict[str, Any]]:
        if event_type in {"TOOL_CALL_START", "TOOL_CALL_CHUNK"}:
            return self._start_or_append_agui_tool(remote_event, state)

        tool_call_id = str(remote_event.get("toolCallId") or "")
        if not tool_call_id:
            return []
        if event_type == "TOOL_CALL_ARGS":
            delta = remote_event.get("delta")
            if isinstance(delta, str):
                state.tool_args[tool_call_id] = state.tool_args.get(tool_call_id, "") + delta
            return []
        if event_type == "TOOL_CALL_END":
            arguments = self._decode_agui_content(state.tool_args.get(tool_call_id, ""))
            return [
                {
                    "type": "tool.progress",
                    "conversationId": state.conversation_id,
                    "messageId": state.assistant_message_id,
                    "toolCallId": tool_call_id,
                    "label": state.tool_names.get(tool_call_id, "tool"),
                    "detail": self._agui_tool_arguments_detail(arguments),
                    "status": "running",
                }
            ]
        if event_type == "TOOL_CALL_RESULT":
            return self._agui_tool_result_events(remote_event, state, tool_call_id)
        return []

    def _start_or_append_agui_tool(
        self,
        remote_event: dict[str, Any],
        state: _AGUIStreamState,
    ) -> list[dict[str, Any]]:
        tool_call_id = str(remote_event.get("toolCallId") or state.active_tool_call_id or "")
        if not tool_call_id:
            return []
        state.active_tool_call_id = tool_call_id
        tool_name = str(
            remote_event.get("toolCallName") or state.tool_names.get(tool_call_id) or "tool"
        )
        state.tool_names[tool_call_id] = tool_name
        events: list[dict[str, Any]] = []
        if tool_call_id not in state.started_tools:
            events.extend(self._start_agui_message(state))
            state.started_tools.add(tool_call_id)
            events.extend(
                self._tool_call_events(
                    state.conversation_id,
                    state.assistant_message_id,
                    tool_call_id,
                    {"name": tool_name, "args": None},
                )
            )
        delta = remote_event.get("delta")
        if isinstance(delta, str):
            state.tool_args[tool_call_id] = state.tool_args.get(tool_call_id, "") + delta
        return events

    def _agui_tool_result_events(
        self,
        remote_event: dict[str, Any],
        state: _AGUIStreamState,
        tool_call_id: str,
    ) -> list[dict[str, Any]]:
        tool_name = state.tool_names.get(tool_call_id, "tool")
        events: list[dict[str, Any]] = []
        if tool_call_id not in state.started_tools:
            events.extend(self._start_agui_message(state))
            state.started_tools.add(tool_call_id)
            events.extend(
                self._tool_call_events(
                    state.conversation_id,
                    state.assistant_message_id,
                    tool_call_id,
                    {"name": tool_name, "args": None},
                )
            )
        events.extend(
            [
                {
                    "type": "tool.progress",
                    "conversationId": state.conversation_id,
                    "messageId": state.assistant_message_id,
                    "toolCallId": tool_call_id,
                    "label": tool_name,
                    "detail": "Tool finished",
                    "status": "complete",
                },
                {
                    "type": "tool.result",
                    "conversationId": state.conversation_id,
                    "messageId": state.assistant_message_id,
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                    "result": self._decode_agui_content(remote_event.get("content")),
                },
            ]
        )
        return events

    def _start_agui_message(self, state: _AGUIStreamState) -> list[dict[str, Any]]:
        if state.started:
            return []
        state.started = True
        return [self._message_start_event_from_agui(state)]

    def _message_start_event_from_agui(
        self,
        state: _AGUIStreamState,
    ) -> dict[str, Any]:
        return self._message_start_event(
            state.conversation_id,
            state.assistant_message_id,
            state.remote_sender_id,
        )

    def _build_agui_run_input(
        self,
        *,
        thread_id: str,
        run_id: str,
        remote_agent_id: str,
        conversation_id: str,
        messages: list[Any],
        message: str,
        attachments: list[Any] | None,
    ) -> dict[str, Any]:
        agui_messages: list[dict[str, Any]] = []
        for index, history_message in enumerate(messages):
            role = str(self._content_value(history_message, "role") or "")
            if role not in {"user", "assistant"}:
                continue
            content = self._agui_history_content(self._content_value(history_message, "content"))
            agui_messages.append(
                {
                    "id": self._agui_message_id(
                        conversation_id,
                        index,
                        role,
                        content,
                    ),
                    "role": role,
                    "content": content,
                }
            )

        current_content = self._agui_user_content(message, attachments)
        agui_messages.append(
            {
                "id": f"user-{uuid4().hex}",
                "role": "user",
                "content": current_content,
            }
        )
        request = RunAgentInput(
            thread_id=thread_id,
            run_id=run_id,
            state={},
            messages=agui_messages,
            tools=[],
            context=[],
            forwarded_props={"agentId": remote_agent_id},
        )
        return request.model_dump(mode="json", by_alias=True, exclude_none=True)

    def _agui_history_content(self, content: Any) -> Any:
        if isinstance(content, str):
            return content
        if not isinstance(content, list):
            return str(content)

        parts: list[dict[str, Any]] = []
        for block in content:
            block_type = self._content_value(block, "type")
            if block_type == "text":
                parts.append(
                    {
                        "type": "text",
                        "text": str(self._content_value(block, "text") or ""),
                    }
                )
            elif block_type == "attachment":
                attachment = self._content_value(block, "attachment")
                if attachment is not None:
                    parts.append(self._agui_attachment_part(attachment))
        return parts

    def _agui_user_content(
        self,
        message: str,
        attachments: list[Any] | None,
    ) -> Any:
        if not attachments:
            return message
        parts: list[dict[str, Any]] = []
        if message.strip():
            parts.append({"type": "text", "text": message})
        parts.extend(self._agui_attachment_part(attachment) for attachment in attachments)
        return parts

    def _agui_attachment_part(self, attachment: Any) -> dict[str, Any]:
        name = str(self._content_value(attachment, "name") or "attachment")
        mime_type = str(
            self._content_value(attachment, "mime_type", "mimeType") or "application/octet-stream"
        )
        data = str(self._content_value(attachment, "data") or "")
        try:
            base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError) as exc:
            msg = f"Attachment {name} contains invalid base64 data."
            raise ServiceError(msg) from exc

        modality = "document"
        if mime_type.startswith("image/"):
            modality = "image"
        elif mime_type.startswith("audio/"):
            modality = "audio"
        elif mime_type.startswith("video/"):
            modality = "video"
        return {
            "type": modality,
            "source": {
                "type": "data",
                "value": data,
                "mimeType": mime_type,
            },
            "metadata": {"filename": name},
        }

    @staticmethod
    def _agui_message_id(
        conversation_id: str,
        index: int,
        role: str,
        content: Any,
    ) -> str:
        identity = json.dumps(
            [conversation_id, index, role, content],
            sort_keys=True,
            default=str,
        )
        return f"message-{uuid5(NAMESPACE_URL, identity).hex}"

    @staticmethod
    async def _iter_agui_events(response: Any) -> AsyncIterator[dict[str, Any]]:
        """Decode text/event-stream data frames from an AG-UI endpoint."""
        data_lines: list[str] = []
        async for line in response.aiter_lines():
            if not line:
                if data_lines:
                    payload = "\n".join(data_lines)
                    data_lines = []
                    event = ChatService._parse_agui_event(payload)
                    if event is not None:
                        yield event
                continue
            if line.startswith((":", "event:", "id:")):
                continue
            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
            elif line.startswith("{"):
                event = ChatService._parse_agui_event(line)
                if event is not None:
                    yield event

        if data_lines:
            event = ChatService._parse_agui_event("\n".join(data_lines))
            if event is not None:
                yield event

    @staticmethod
    def _parse_agui_event(payload: str) -> dict[str, Any] | None:
        if payload.strip() in {"", "[DONE]"}:
            return None
        decoded = json.loads(payload)
        if not isinstance(decoded, dict):
            return None
        try:
            event = agui_event_adapter.validate_python(decoded)
        except ValidationError:
            _log.warning("Ignoring unrecognized AG-UI event type %r", decoded.get("type"))
            return None
        return event.model_dump(mode="json", by_alias=True, exclude_none=True)

    @staticmethod
    def _decode_agui_content(content: Any) -> Any:
        if not isinstance(content, str):
            return content
        stripped = content.strip()
        if not stripped:
            return ""
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            return content

    @classmethod
    def _agui_tool_arguments_detail(cls, arguments: Any) -> str:
        if arguments is None or arguments == "":
            return "Tool call submitted"
        return f"Arguments: {cls._stable_json(arguments)}"

    @classmethod
    def _agui_result_text(cls, result: Any) -> str:
        if isinstance(result, str):
            return result
        if result is None:
            return ""
        return cls._stable_json(result)

    @staticmethod
    def _agui_context_key(remote_agent_server_id: int, conversation_id: str) -> str:
        return f"{remote_agent_server_id}:{conversation_id}"

    async def _stream_a2a_chat_events(
        self,
        *,
        remote_sender_id: str,
        remote_agent_server_id: int,
        remote_agent_id: str,
        conversation_id: str,
        message: str,
        attachments: list[Any] | None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Translate an iHub user turn to A2A and normalize its response stream."""
        remote_agent_service = self._require_remote_agent_service()
        remote_agent = remote_agent_service.get_remote_agent(remote_agent_server_id)
        discovered_agent = remote_agent_service.get_discovered_remote_agent(
            remote_agent_server_id,
            remote_agent_id,
        )
        assistant_message_id = f"assistant-{uuid4().hex}"
        context_key = self._a2a_context_key(remote_agent_server_id, conversation_id)
        context_id = a2a_context_cache.get(context_key, self._remote_thread_id(conversation_id))
        request = SendMessageRequest(
            message=new_message(
                parts=self._build_a2a_parts(message, attachments),
                context_id=context_id,
                role=Role.ROLE_USER,
            ),
        )
        client = None
        aggregated_content = ""
        started = False
        seen_tool_calls: set[str] = set()
        seen_tool_results: set[str] = set()
        tool_names: dict[str, str] = {}

        try:
            client = await remote_agent_service.get_a2a_client(
                remote_agent,
                discovered_agent,
            )
            async for response in client.send_message(request):
                response_context_id = self._a2a_response_context_id(response)
                if response_context_id:
                    a2a_context_cache[context_key] = response_context_id

                tool_events = self._a2a_tool_events(
                    response,
                    conversation_id,
                    assistant_message_id,
                    seen_tool_calls,
                    seen_tool_results,
                    tool_names,
                )
                if tool_events and not started:
                    started = True
                    yield self._message_start_event(
                        conversation_id,
                        assistant_message_id,
                        remote_sender_id,
                    )
                for event in tool_events:
                    yield event

                response_text = self._a2a_response_text(response)
                delta = self._a2a_text_delta(response, response_text, aggregated_content)
                if not delta:
                    continue

                if not started:
                    started = True
                    yield self._message_start_event(
                        conversation_id,
                        assistant_message_id,
                        remote_sender_id,
                    )
                aggregated_content += delta
                yield {
                    "type": "message.delta",
                    "conversationId": conversation_id,
                    "messageId": assistant_message_id,
                    "delta": delta,
                }

            if not started:
                yield {
                    "type": "error",
                    "conversationId": conversation_id,
                    "messageId": assistant_message_id,
                    "error": "A2A agent completed without returning text content.",
                }
                return

            yield {
                "type": "message.complete",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "content": aggregated_content,
            }
        except Exception as exc:  # noqa: BLE001
            _log.error("Failed to stream A2A chat events: %s", exc, exc_info=True)
            if started:
                yield {
                    "type": "message.complete",
                    "conversationId": conversation_id,
                    "messageId": assistant_message_id,
                    "content": aggregated_content,
                }
            yield {
                "type": "error",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "error": f"A2A agent invocation failed: {exc!s}",
            }
        finally:
            if client is not None:
                await client.close()

    def _build_a2a_parts(
        self,
        message: str,
        attachments: list[Any] | None,
    ) -> list[Any]:
        """Build A2A text and raw-file parts for one iHub user turn."""
        parts: list[Any] = []
        if message.strip():
            parts.append(new_text_part(message, media_type="text/plain"))

        for attachment in attachments or []:
            name = str(self._content_value(attachment, "name") or "attachment")
            media_type = str(
                self._content_value(attachment, "mime_type", "mimeType")
                or "application/octet-stream"
            )
            encoded_data = str(self._content_value(attachment, "data") or "")
            try:
                data = base64.b64decode(encoded_data, validate=True)
            except (binascii.Error, ValueError) as exc:
                msg = f"Attachment {name} contains invalid base64 data."
                raise ServiceError(msg) from exc
            parts.append(new_raw_part(data, media_type=media_type, filename=name))

        return parts

    @staticmethod
    def _a2a_response_text(response: StreamResponse) -> str:
        """Extract text from direct messages, task updates, and artifacts."""
        if response.HasField("message") and response.message.role != Role.ROLE_AGENT:
            return ""
        if (
            response.HasField("status_update")
            and response.status_update.status.HasField("message")
            and response.status_update.status.message.role != Role.ROLE_AGENT
        ):
            return ""
        text = get_stream_response_text(response)
        if text or not response.HasField("task"):
            return text

        task = response.task
        if task.status.HasField("message"):
            text = get_message_text(task.status.message)
            if text:
                return text
        for history_message in reversed(task.history):
            if history_message.role == Role.ROLE_AGENT:
                text = get_message_text(history_message)
                if text:
                    return text
        return ""

    @staticmethod
    def _a2a_text_delta(
        response: StreamResponse,
        response_text: str,
        aggregated_content: str,
    ) -> str:
        """Convert A2A chunks or snapshots into an incremental text delta."""
        if not response_text:
            return ""
        if response.HasField("artifact_update") and response.artifact_update.append:
            return response_text
        if response_text.startswith(aggregated_content):
            return response_text[len(aggregated_content) :]
        if aggregated_content.endswith(response_text):
            return ""
        return response_text

    @staticmethod
    def _a2a_response_context_id(response: StreamResponse) -> str | None:
        if response.HasField("message"):
            return response.message.context_id or None
        if response.HasField("task"):
            return response.task.context_id or None
        if response.HasField("status_update"):
            return response.status_update.context_id or None
        if response.HasField("artifact_update"):
            return response.artifact_update.context_id or None
        return None

    def _a2a_tool_events(
        self,
        response: StreamResponse,
        conversation_id: str,
        assistant_message_id: str,
        seen_tool_calls: set[str],
        seen_tool_results: set[str],
        tool_names: dict[str, str],
    ) -> list[dict[str, Any]]:
        """Translate structured A2A tool disclosures to iHub chat events.

        A2A does not prescribe a single tool-call payload. Remote frameworks
        commonly expose OpenAI, Anthropic, LangChain, or Google-style records
        in data parts or metadata, so these are normalized at this boundary.
        """
        events: list[dict[str, Any]] = []
        for payload in self._a2a_structured_payloads(response):
            for signal in self._a2a_tool_signals(payload):
                kind = str(signal["kind"])
                tool_name = str(signal.get("name") or "tool")
                tool_call_id = self._a2a_tool_call_id(
                    signal,
                    tool_name,
                    kind,
                    seen_tool_results,
                    tool_names,
                )

                if kind == "call":
                    if tool_call_id in seen_tool_calls:
                        continue
                    seen_tool_calls.add(tool_call_id)
                    tool_names[tool_call_id] = tool_name
                    events.extend(
                        self._tool_call_events(
                            conversation_id,
                            assistant_message_id,
                            tool_call_id,
                            {
                                "name": tool_name,
                                "args": signal.get("arguments"),
                            },
                        )
                    )
                    continue

                result_fingerprint = self._stable_json([tool_call_id, signal.get("result")])
                if result_fingerprint in seen_tool_results:
                    continue
                seen_tool_results.add(result_fingerprint)
                resolved_name = tool_names.get(tool_call_id, tool_name)
                if tool_call_id not in seen_tool_calls:
                    seen_tool_calls.add(tool_call_id)
                    tool_names[tool_call_id] = resolved_name
                    events.extend(
                        self._tool_call_events(
                            conversation_id,
                            assistant_message_id,
                            tool_call_id,
                            {"name": resolved_name, "args": None},
                        )
                    )
                events.extend(
                    [
                        {
                            "type": "tool.progress",
                            "conversationId": conversation_id,
                            "messageId": assistant_message_id,
                            "toolCallId": tool_call_id,
                            "label": resolved_name,
                            "detail": "Tool finished",
                            "status": "complete",
                        },
                        {
                            "type": "tool.result",
                            "conversationId": conversation_id,
                            "messageId": assistant_message_id,
                            "toolCallId": tool_call_id,
                            "toolName": resolved_name,
                            "result": signal.get("result"),
                        },
                    ]
                )
        return events

    @staticmethod
    def _a2a_structured_payloads(response: StreamResponse) -> list[Any]:
        """Collect data parts and metadata from every A2A response variant."""
        payloads: list[Any] = []

        def add_message(message: Any) -> None:
            if message.role != Role.ROLE_AGENT:
                return
            payloads.extend(get_data_parts(message.parts))
            if message.HasField("metadata"):
                payloads.append(MessageToDict(message.metadata))

        def add_artifact(artifact: Any) -> None:
            payloads.extend(get_data_parts(artifact.parts))
            if artifact.HasField("metadata"):
                payloads.append(MessageToDict(artifact.metadata))

        if response.HasField("message"):
            add_message(response.message)
        elif response.HasField("task"):
            task = response.task
            if task.status.HasField("message"):
                add_message(task.status.message)
            for message in task.history:
                add_message(message)
            for artifact in task.artifacts:
                add_artifact(artifact)
            if task.HasField("metadata"):
                payloads.append(MessageToDict(task.metadata))
        elif response.HasField("status_update"):
            update = response.status_update
            if update.status.HasField("message"):
                add_message(update.status.message)
            if update.HasField("metadata"):
                payloads.append(MessageToDict(update.metadata))
        elif response.HasField("artifact_update"):
            update = response.artifact_update
            add_artifact(update.artifact)
            if update.HasField("metadata"):
                payloads.append(MessageToDict(update.metadata))
        return payloads

    @classmethod
    def _a2a_tool_signals(cls, payload: Any) -> list[dict[str, Any]]:
        """Find common structured tool-call and tool-result representations."""
        signals: list[dict[str, Any]] = []

        def visit(value: Any) -> None:
            if isinstance(value, list):
                for item in value:
                    visit(item)
                return
            if not isinstance(value, dict):
                return

            for key in ("tool_calls", "toolCalls", "function_calls", "functionCalls"):
                calls = value.get(key)
                if isinstance(calls, list):
                    for call in calls:
                        signal = cls._normalize_a2a_tool_signal(call, "call")
                        if signal:
                            signals.append(signal)

            wrappers = (
                ("tool_call", "call"),
                ("toolCall", "call"),
                ("function_call", "call"),
                ("functionCall", "call"),
                ("tool_result", "result"),
                ("toolResult", "result"),
                ("function_response", "result"),
                ("functionResponse", "result"),
            )
            for key, kind in wrappers:
                wrapped = value.get(key)
                if isinstance(wrapped, dict):
                    signal = cls._normalize_a2a_tool_signal(wrapped, kind)
                    if signal:
                        signals.append(signal)

            signal_type = str(value.get("type") or value.get("kind") or "")
            normalized_type = re.sub(r"[.\- ]", "_", signal_type).lower()
            if normalized_type in {"tool_call", "function_call", "tool_use"}:
                signal = cls._normalize_a2a_tool_signal(value, "call")
                if signal:
                    signals.append(signal)
            elif normalized_type in {
                "tool_result",
                "tool_output",
                "function_call_output",
                "function_response",
            }:
                signal = cls._normalize_a2a_tool_signal(value, "result")
                if signal:
                    signals.append(signal)

            for nested in value.values():
                if isinstance(nested, dict | list):
                    visit(nested)

        visit(payload)
        unique: list[dict[str, Any]] = []
        fingerprints: set[str] = set()
        for signal in signals:
            fingerprint = cls._stable_json(signal)
            if fingerprint not in fingerprints:
                fingerprints.add(fingerprint)
                unique.append(signal)
        return unique

    @staticmethod
    def _normalize_a2a_tool_signal(
        value: Any,
        kind: str,
    ) -> dict[str, Any] | None:
        if not isinstance(value, dict):
            return None
        function = value.get("function")
        details = function if isinstance(function, dict) else value
        name = details.get("name") or value.get("tool_name") or value.get("toolName")
        identifier = (
            value.get("id")
            or value.get("call_id")
            or value.get("callId")
            or value.get("tool_call_id")
            or value.get("toolCallId")
            or value.get("tool_use_id")
        )
        if kind == "call":
            arguments = details.get("arguments")
            if arguments is None:
                arguments = details.get("args", details.get("input"))
            if not name and arguments is None:
                return None
            return {
                "kind": "call",
                "id": identifier,
                "name": name,
                "arguments": arguments,
            }

        result = value.get("result")
        if result is None:
            result = value.get("output")
        if result is None:
            result = value.get("response", value.get("content"))
        if not name and not identifier and result is None:
            return None
        return {
            "kind": "result",
            "id": identifier,
            "name": name,
            "result": result,
        }

    @classmethod
    def _a2a_tool_call_id(
        cls,
        signal: dict[str, Any],
        tool_name: str,
        kind: str,
        seen_tool_results: set[str],
        tool_names: dict[str, str],
    ) -> str:
        identifier = signal.get("id")
        if identifier:
            return str(identifier)
        if kind == "result":
            matching_ids = [
                tool_call_id
                for tool_call_id, known_name in tool_names.items()
                if known_name == tool_name
                and not any(tool_call_id in item for item in seen_tool_results)
            ]
            if matching_ids:
                return matching_ids[-1]
        fingerprint = cls._stable_json(
            [tool_name, signal.get("arguments") if kind == "call" else kind]
        )
        return f"a2a-{uuid5(NAMESPACE_URL, fingerprint).hex}"

    @staticmethod
    def _stable_json(value: Any) -> str:
        try:
            return json.dumps(value, sort_keys=True, default=str)
        except (TypeError, ValueError):
            return repr(value)

    @staticmethod
    def _a2a_context_key(remote_agent_server_id: int, conversation_id: str) -> str:
        return f"{remote_agent_server_id}:{conversation_id}"

    def clear_conversation(self, agent_id: UUID, conversation_id: str) -> None:
        cache_prefix = f"{agent_id}:{conversation_id}"
        keys_to_delete = [
            cache_key
            for cache_key in graph_cache
            if cache_key == cache_prefix or cache_key.startswith(f"{cache_prefix}:")
        ]

        for cache_key in keys_to_delete:
            del graph_cache[cache_key]

        if keys_to_delete:
            _log.info(
                "Cleared %d conversation cache entrie(s) for %s",
                len(keys_to_delete),
                cache_prefix,
            )

    def clear_mixed_group_conversation(
        self,
        supervisor_agent_id: UUID,
        conversation_id: str,
        participant_agent_ids: list[str],
    ) -> None:
        """Clear isolated local and remote state owned by a mixed room."""
        self.clear_conversation(supervisor_agent_id, conversation_id)
        self.clear_conversation(
            supervisor_agent_id,
            self._group_supervisor_conversation_id(conversation_id),
        )
        self.clear_conversation(
            supervisor_agent_id,
            self._group_planning_conversation_id(conversation_id),
        )

        for selector_id in dict.fromkeys(participant_agent_ids):
            participant_conversation_id = self._group_participant_conversation_id(
                conversation_id,
                selector_id,
            )
            if selector_id.startswith("remote:"):
                remote_agent_server_id, _ = self._parse_remote_selector(selector_id)
                self.clear_remote_agent_conversation(
                    remote_agent_server_id,
                    participant_conversation_id,
                )
                continue
            try:
                local_agent_id = UUID(selector_id)
            except ValueError:
                _log.warning(
                    "Ignoring invalid group participant during clear: %s",
                    selector_id,
                )
                continue
            self.clear_conversation(local_agent_id, participant_conversation_id)

    def _chat_remote(
        self,
        remote_agent_id: int | None,
        assistant_id_override: str | None,
        conversation_id: str,
        messages: list[Any],
        message: str,
        attachments: list[Any] | None = None,
    ) -> str:
        if remote_agent_id is None:
            msg = "Remote agent server is enabled but no remote_agent_id is configured."
            raise ServiceError(msg)

        remote_agent_service = self._require_remote_agent_service()
        remote_agent = remote_agent_service.get_remote_agent(remote_agent_id)
        client = remote_agent_service.get_sync_client(remote_agent)
        remote_messages = self._build_remote_messages(messages, message, attachments)
        assistant_id = assistant_id_override or remote_agent.assistant_id
        remote_thread_id = self._remote_thread_id(conversation_id)

        if not assistant_id:
            msg = "Remote agent id is not configured."
            raise ServiceError(msg)

        try:
            run_state = client.runs.wait(
                thread_id=remote_thread_id,
                assistant_id=assistant_id,
                input={"messages": remote_messages},
                if_not_exists="create",
            )
            return self._extract_response_text_from_state(run_state)
        except Exception as exc:
            _log.error("Failed to invoke remote agent server: %s", exc, exc_info=True)
            msg = f"Remote agent server invocation failed: {exc!s}"
            raise ServiceError(msg) from exc
        finally:
            client.close()

    async def _stream_remote_chat_events(
        self,
        agent_id: UUID | str,
        remote_agent_id: int | None,
        assistant_id_override: str | None,
        conversation_id: str,
        messages: list[Any],
        message: str,
        attachments: list[Any] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        if remote_agent_id is None:
            msg = "Remote agent server is enabled but no remote_agent_id is configured."
            raise ServiceError(msg)

        remote_agent_service = self._require_remote_agent_service()
        remote_agent = remote_agent_service.get_remote_agent(remote_agent_id)
        client = remote_agent_service.get_async_client(remote_agent)
        assistant_id = assistant_id_override or remote_agent.assistant_id
        remote_thread_id = self._remote_thread_id(conversation_id)

        if not assistant_id:
            msg = "Remote agent id is not configured."
            raise ServiceError(msg)

        remote_messages = self._build_remote_messages(messages, message, attachments)
        assistant_message_id = f"assistant-{uuid4().hex}"

        skip_ids, prior_message_count = await self._load_remote_thread_identity(
            client,
            remote_thread_id,
        )

        # Track content already emitted per LangGraph message ID so that each
        # snapshot only emits the new suffix (incremental delta).
        emitted_text: dict[str, str] = {}
        # Track tool-call IDs already emitted from AI messages (per message ID).
        emitted_tool_calls: dict[str, set[str]] = {}
        # Track tool-result message IDs already fully forwarded.
        emitted_tool_msg_ids: set[str] = set()

        aggregated_content = ""
        started = False

        try:
            async for chunk in client.runs.stream(
                thread_id=remote_thread_id,
                assistant_id=assistant_id,
                input={"messages": remote_messages},
                stream_mode="values",
                if_not_exists="create",
            ):
                event_name = getattr(chunk, "event", "")
                if event_name != "values":
                    continue

                state = getattr(chunk, "data", None)
                graph_messages = self._extract_graph_messages(state)
                if not graph_messages:
                    continue

                for event in self._remote_events_from_stream_messages(
                    agent_id=str(agent_id),
                    conversation_id=conversation_id,
                    assistant_message_id=assistant_message_id,
                    graph_messages=graph_messages,
                    skip_ids=skip_ids,
                    prior_message_count=prior_message_count,
                    emitted_text=emitted_text,
                    emitted_tool_calls=emitted_tool_calls,
                    emitted_tool_msg_ids=emitted_tool_msg_ids,
                ):
                    if event["type"] == "message.start":
                        if started:
                            continue
                        started = True
                    elif event["type"] == "message.delta":
                        aggregated_content += cast(str, event["delta"])
                    yield event

            if started:
                yield {
                    "type": "message.complete",
                    "conversationId": conversation_id,
                    "messageId": assistant_message_id,
                    "content": aggregated_content,
                }
                return

            if attachments is None:
                response_text = self._chat_remote(
                    remote_agent_id,
                    assistant_id,
                    conversation_id,
                    messages,
                    message,
                )
            else:
                response_text = self._chat_remote(
                    remote_agent_id,
                    assistant_id,
                    conversation_id,
                    messages,
                    message,
                    attachments,
                )
            yield self._message_start_event(conversation_id, assistant_message_id, str(agent_id))
            yield {
                "type": "message.delta",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "delta": response_text,
            }
            yield {
                "type": "message.complete",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "content": response_text,
            }
        except Exception as exc:  # noqa: BLE001
            _log.error("Failed to stream remote chat events: %s", exc, exc_info=True)
            if started:
                yield {
                    "type": "message.complete",
                    "conversationId": conversation_id,
                    "messageId": assistant_message_id,
                    "content": aggregated_content,
                }
            yield {
                "type": "error",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "error": f"Remote agent server invocation failed: {exc!s}",
            }
        finally:
            await client.aclose()

    def _delete_remote_thread(self, remote_agent_id: int | None, conversation_id: str) -> None:
        if remote_agent_id is None:
            return

        try:
            remote_agent_service = self._require_remote_agent_service()
            remote_agent = remote_agent_service.get_remote_agent(remote_agent_id)
            client = remote_agent_service.get_sync_client(remote_agent)
            try:
                client.threads.delete(self._remote_thread_id(conversation_id))
            finally:
                client.close()
        except Exception as exc:  # noqa: BLE001
            _log.warning(
                "Failed to clear remote thread for remote_agent_id=%s conversation_id=%s: %s",
                remote_agent_id,
                conversation_id,
                exc,
            )

    def _remote_thread_id(self, conversation_id: str) -> str:
        """Return a UUID thread id for remote LangGraph APIs.

        Remote APIs require a UUID-shaped thread id. Local chat ids may be
        arbitrary strings (e.g. "chat-..."). We preserve deterministic mapping
        so the same conversation id always targets the same remote thread.
        """
        try:
            return str(UUID(conversation_id))
        except ValueError:
            return str(uuid5(NAMESPACE_URL, conversation_id))

    def _build_remote_messages(
        self,
        messages: list[Any],
        message: str,
        attachments: list[Any] | None = None,
    ) -> list[dict[str, Any]]:
        # Remote runs are executed against a stable thread id; that thread
        # already retains prior turns. Re-sending the full local transcript
        # each turn duplicates history remotely and can cause echoed transcripts.
        _ = messages
        return [{"role": "user", "content": self._build_user_content(message, attachments)}]

    def _extract_response_text_from_state(self, run_state: Any) -> str:
        if isinstance(run_state, dict):
            messages = run_state.get("messages", [])
            if isinstance(messages, list) and messages:
                return self._extract_message_text(messages[-1])

        if isinstance(run_state, list) and run_state:
            return self._extract_message_text(run_state[-1])

        return ""

    def _build_messages_history(
        self,
        messages: list[Any],
        message: str,
        attachments: list[Any] | None = None,
    ) -> list[Any]:
        from langchain_core.messages import AIMessage, HumanMessage

        messages_history: list[Any] = []
        for msg in messages:
            if msg.role == "user":
                messages_history.append(
                    HumanMessage(content=self._normalize_socket_content(msg.content))
                )
            elif msg.role == "assistant":
                messages_history.append(
                    AIMessage(content=self._normalize_socket_content(msg.content))
                )

        messages_history.append(
            HumanMessage(content=self._build_user_content(message, attachments))
        )
        return messages_history

    def _build_user_content(self, message: str, attachments: list[Any] | None) -> str | list[Any]:
        if not attachments:
            return message

        content: list[Any] = []
        if message.strip():
            content.append({"type": "text", "text": message})
        content.extend(self._attachment_content_block(attachment) for attachment in attachments)
        return content

    def _normalize_socket_content(self, content: Any) -> str | list[Any]:
        if isinstance(content, str):
            return content
        if not isinstance(content, list):
            return str(content)

        normalized: list[Any] = []
        for block in content:
            block_type = self._content_value(block, "type")
            if block_type == "text":
                normalized.append(
                    {"type": "text", "text": str(self._content_value(block, "text") or "")}
                )
            elif block_type == "attachment":
                attachment = self._content_value(block, "attachment")
                if attachment is not None:
                    normalized.append(self._attachment_content_block(attachment))
        return normalized

    def _attachment_content_block(self, attachment: Any) -> dict[str, Any]:
        name = str(self._content_value(attachment, "name") or "attachment")
        mime_type = str(
            self._content_value(attachment, "mime_type", "mimeType") or "application/octet-stream"
        )
        data = str(self._content_value(attachment, "data") or "")

        try:
            decoded = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError) as exc:
            msg = f"Attachment {name} contains invalid base64 data."
            raise ServiceError(msg) from exc

        if mime_type == "application/pdf" or self._attachment_extension(name) == ".pdf":
            return self._attachment_text_block(name, self._extract_pdf_text(name, decoded))

        if mime_type.startswith("image/"):
            return {
                "type": "image",
                "base64": data,
                "mime_type": mime_type,
                "extras": {"filename": name},
            }

        try:
            text = decoded.decode("utf-8")
        except UnicodeDecodeError as exc:
            msg = (
                f"Attachment {name} is binary data that cannot be read as UTF-8 text. "
                "Attach a UTF-8 text file, PDF, or image instead."
            )
            raise ServiceError(msg) from exc
        return self._attachment_text_block(name, text)

    def _attachment_text_block(self, name: str, text: str) -> dict[str, str]:
        normalized_text = text.strip()
        if not normalized_text:
            msg = f"Attachment {name} does not contain extractable text."
            raise ServiceError(msg)

        if len(normalized_text) > MAX_EXTRACTED_ATTACHMENT_CHARS:
            normalized_text = (
                f"{normalized_text[:MAX_EXTRACTED_ATTACHMENT_CHARS]}\n\n"
                "[Attachment text truncated by iHub.]"
            )
        return {
            "type": "text",
            "text": f"Attached file: {name}\n\n{normalized_text}",
        }

    def _extract_pdf_text(self, name: str, data: bytes) -> str:
        try:
            reader = PdfReader(io.BytesIO(data))
            return "\n\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:
            msg = f"Unable to extract text from PDF attachment {name}."
            raise ServiceError(msg) from exc

    def _attachment_extension(self, name: str) -> str:
        dot_index = name.rfind(".")
        return name[dot_index:].lower() if dot_index >= 0 else ""

    def _content_value(self, value: Any, key: str, alias: str | None = None) -> Any:
        if isinstance(value, dict):
            return value.get(key, value.get(alias)) if alias else value.get(key)
        return getattr(value, key, None)

    def _extract_graph_messages(self, state: Any) -> list[Any]:
        if isinstance(state, dict):
            messages = state.get("messages", [])
            if isinstance(messages, list):
                return messages
        if isinstance(state, list):
            return state
        return []

    def _extract_thread_state_values(self, state: Any) -> Any:
        """Return the `values` payload from LangGraph thread state objects."""
        if isinstance(state, dict):
            values = state.get("values")
            return values if values is not None else state

        state_attr = getattr(state, "values", None)
        if isinstance(state_attr, dict | list):
            return state_attr

        return {}

    async def _load_remote_thread_identity(
        self,
        client: Any,
        remote_thread_id: str,
    ) -> tuple[set[str], int]:
        """Return existing remote message ids and count for replay suppression."""
        skip_ids: set[str] = set()
        prior_message_count = 0

        try:
            prior_state = await client.threads.get_state(remote_thread_id)
            prior_values = self._extract_thread_state_values(prior_state)
            prior_messages = self._extract_graph_messages(prior_values)
            prior_message_count = len(prior_messages)
            for prior_msg in prior_messages:
                prior_id = self._extract_message_value(prior_msg, "id")
                if prior_id:
                    skip_ids.add(str(prior_id))
        except Exception as exc:  # noqa: BLE001
            _log.debug(
                "Remote thread state unavailable for thread_id=%s: %s",
                remote_thread_id,
                exc,
            )

        return skip_ids, prior_message_count

    def _remote_events_from_stream_messages(
        self,
        *,
        agent_id: str,
        conversation_id: str,
        assistant_message_id: str,
        graph_messages: list[Any],
        skip_ids: set[str],
        prior_message_count: int,
        emitted_text: dict[str, str],
        emitted_tool_calls: dict[str, set[str]],
        emitted_tool_msg_ids: set[str],
    ) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        started = False

        for message_index, graph_message in enumerate(graph_messages):
            msg_id = self._extract_message_value(graph_message, "id")
            msg_id_str = str(msg_id) if msg_id else None
            message_key = msg_id_str or f"anon:{message_index}"

            if msg_id_str and msg_id_str in skip_ids:
                continue
            if not msg_id_str and message_index < prior_message_count:
                continue
            if self._is_user_message(graph_message):
                continue

            if self._is_tool_message(graph_message):
                if message_key in emitted_tool_msg_ids:
                    continue
                emitted_tool_msg_ids.add(message_key)
                started = self._ensure_remote_message_started(
                    events,
                    started,
                    conversation_id,
                    assistant_message_id,
                    agent_id,
                )
                events.extend(
                    self._tool_result_events(
                        conversation_id,
                        assistant_message_id,
                        graph_message,
                    )
                )
                continue

            tool_calls = self._extract_tool_calls(graph_message)
            if tool_calls:
                prior_calls = emitted_tool_calls.setdefault(message_key, set())
                for tool_call in cast(list[dict[str, Any]], tool_calls):
                    tc_id = str(tool_call.get("id") or uuid4().hex)
                    if tc_id in prior_calls:
                        continue
                    prior_calls.add(tc_id)
                    started = self._ensure_remote_message_started(
                        events,
                        started,
                        conversation_id,
                        assistant_message_id,
                        agent_id,
                    )
                    events.extend(
                        self._tool_call_events(
                            conversation_id,
                            assistant_message_id,
                            tc_id,
                            tool_call,
                        )
                    )

            text = self._extract_message_text(graph_message)
            if not text:
                continue

            prior_text = emitted_text.get(message_key, "")
            delta = text[len(prior_text) :] if text.startswith(prior_text) else text
            if not delta:
                continue

            started = self._ensure_remote_message_started(
                events,
                started,
                conversation_id,
                assistant_message_id,
                agent_id,
            )
            events.append(
                {
                    "type": "message.delta",
                    "conversationId": conversation_id,
                    "messageId": assistant_message_id,
                    "delta": delta,
                }
            )
            emitted_text[message_key] = text

        return events

    def _ensure_remote_message_started(
        self,
        events: list[dict[str, Any]],
        started: bool,
        conversation_id: str,
        assistant_message_id: str,
        agent_id: str,
    ) -> bool:
        if started:
            return True

        events.append(
            self._message_start_event(
                conversation_id,
                assistant_message_id,
                agent_id,
            )
        )
        return True

    def _tool_call_events(
        self,
        conversation_id: str,
        assistant_message_id: str,
        tool_call_id: str,
        tool_call: dict[str, Any],
    ) -> list[dict[str, Any]]:
        tool_name = str(tool_call.get("name", "tool"))
        return [
            {
                "type": "tool.start",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "toolCallId": tool_call_id,
                "toolName": tool_name,
                "input": tool_call.get("args"),
                "timestamp": datetime.now(UTC).isoformat(),
            },
            {
                "type": "tool.progress",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "toolCallId": tool_call_id,
                "label": tool_name,
                "detail": "Running tool",
                "status": "running",
            },
        ]

    def _tool_result_events(
        self,
        conversation_id: str,
        assistant_message_id: str,
        graph_message: Any,
    ) -> list[dict[str, Any]]:
        tool_call_id = str(
            self._extract_message_value(graph_message, "tool_call_id") or uuid4().hex
        )
        tool_name = str(
            self._extract_message_value(graph_message, "name")
            or self._extract_message_value(graph_message, "tool_name")
            or "tool"
        )
        return [
            {
                "type": "tool.progress",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "toolCallId": tool_call_id,
                "label": tool_name,
                "detail": "Tool finished",
                "status": "complete",
            },
            {
                "type": "tool.result",
                "conversationId": conversation_id,
                "messageId": assistant_message_id,
                "toolCallId": tool_call_id,
                "toolName": tool_name,
                "result": self._extract_tool_output(graph_message),
            },
        ]

    def _events_from_graph_messages(
        self,
        conversation_id: str,
        assistant_message_id: str,
        sender_id: str,
        graph_messages: list[Any],
    ) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        started = False

        for graph_message in graph_messages:
            tool_calls = self._extract_tool_calls(graph_message)
            if tool_calls:
                if not started:
                    events.append(
                        self._message_start_event(
                            conversation_id,
                            assistant_message_id,
                            sender_id,
                        ),
                    )
                    started = True

                for tool_call in cast(list[dict[str, Any]], tool_calls):
                    tool_call_id = str(tool_call.get("id", uuid4().hex))
                    tool_name = str(tool_call.get("name", "tool"))
                    tool_input = tool_call.get("args")
                    events.append(
                        {
                            "type": "tool.start",
                            "conversationId": conversation_id,
                            "messageId": assistant_message_id,
                            "toolCallId": tool_call_id,
                            "toolName": tool_name,
                            "input": tool_input,
                            "timestamp": datetime.now(UTC).isoformat(),
                        },
                    )
                    events.append(
                        {
                            "type": "tool.progress",
                            "conversationId": conversation_id,
                            "messageId": assistant_message_id,
                            "toolCallId": tool_call_id,
                            "label": tool_name,
                            "detail": "Running tool",
                            "status": "running",
                        },
                    )

            text_content = self._extract_message_text(graph_message)
            if text_content:
                if not started:
                    events.append(
                        self._message_start_event(
                            conversation_id,
                            assistant_message_id,
                            sender_id,
                        ),
                    )
                    started = True

                events.append(
                    {
                        "type": "message.delta",
                        "conversationId": conversation_id,
                        "messageId": assistant_message_id,
                        "delta": text_content,
                    },
                )

            if self._is_tool_message(graph_message):
                tool_call_id = str(
                    self._extract_message_value(graph_message, "tool_call_id") or uuid4().hex
                )
                tool_name = str(
                    self._extract_message_value(graph_message, "name")
                    or self._extract_message_value(graph_message, "tool_name")
                    or "tool",
                )
                tool_output = self._extract_tool_output(graph_message)

                if not started:
                    events.append(
                        self._message_start_event(
                            conversation_id,
                            assistant_message_id,
                            sender_id,
                        ),
                    )
                    started = True

                events.append(
                    {
                        "type": "tool.progress",
                        "conversationId": conversation_id,
                        "messageId": assistant_message_id,
                        "toolCallId": tool_call_id,
                        "label": tool_name,
                        "detail": "Tool finished",
                        "status": "complete",
                    },
                )
                events.append(
                    {
                        "type": "tool.result",
                        "conversationId": conversation_id,
                        "messageId": assistant_message_id,
                        "toolCallId": tool_call_id,
                        "toolName": tool_name,
                        "result": tool_output,
                    },
                )

        return events

    def _extract_tool_calls(self, graph_message: Any) -> list[dict[str, Any]]:
        tool_calls = self._extract_message_value(graph_message, "tool_calls")
        if isinstance(tool_calls, list):
            return cast(list[dict[str, Any]], tool_calls)
        return []

    def _extract_message_value(self, graph_message: Any, key: str) -> Any:
        if isinstance(graph_message, dict):
            return graph_message.get(key)
        return getattr(graph_message, key, None)

    def _message_start_event(
        self,
        conversation_id: str,
        assistant_message_id: str,
        sender_id: str,
    ) -> dict[str, Any]:
        return {
            "type": "message.start",
            "conversationId": conversation_id,
            "messageId": assistant_message_id,
            "senderId": sender_id,
            "timestamp": datetime.now(UTC).isoformat(),
        }

    def _extract_message_text(self, graph_message: Any) -> str:
        if self._is_tool_message(graph_message) or self._is_user_message(graph_message):
            return ""

        content = self._extract_message_value(graph_message, "content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            text_segments: list[str] = []
            for item in content:
                if isinstance(item, str):
                    text_segments.append(item)
                elif isinstance(item, dict) and item.get("type") == "text":
                    text_segments.append(str(item.get("text", "")))
            return "".join(text_segments)
        return ""

    def _extract_tool_output(self, graph_message: Any) -> Any:
        artifact = self._extract_message_value(graph_message, "artifact")
        if artifact is not None:
            return self._coerce_structured_tool_output(artifact)

        content = self._extract_message_value(graph_message, "content")
        if content is not None:
            return self._coerce_structured_tool_output(content)
        return str(graph_message)

    def _coerce_structured_tool_output(self, value: Any) -> Any:
        """Best-effort parse of structured tool output from text-like payloads.

        This preserves native JSON objects (for visualization blocks) even when a
        tool returns markdown/prose with an embedded JSON snippet.
        """
        if isinstance(value, dict):
            return value

        if isinstance(value, str):
            parsed = self._parse_json_like_text(value)
            return parsed if parsed is not None else value

        text_attr = getattr(value, "text", None)
        if isinstance(text_attr, str):
            parsed = self._parse_json_like_text(text_attr)
            return parsed if parsed is not None else text_attr

        if isinstance(value, list):
            segments: list[str] = []
            for item in value:
                if isinstance(item, str):
                    segments.append(item)
                    continue

                if isinstance(item, dict):
                    # Some tool adapters expose direct JSON payloads under data/json.
                    json_payload = item.get("json")
                    if isinstance(json_payload, dict | list):
                        return json_payload

                    data_payload = item.get("data")
                    if isinstance(data_payload, dict | list):
                        return data_payload

                    item_text = item.get("text")
                    if isinstance(item_text, str):
                        segments.append(item_text)
                        continue

                item_text_attr = getattr(item, "text", None)
                if isinstance(item_text_attr, str):
                    segments.append(item_text_attr)

            merged = "\n".join(part for part in segments if part).strip()
            if merged:
                parsed = self._parse_json_like_text(merged)
                return parsed if parsed is not None else merged

        return value

    def _parse_json_like_text(self, text: str) -> Any | None:
        stripped = text.strip()
        if not stripped:
            return None

        # Direct JSON payload.
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass

        # JSON fenced code block.
        fenced_match = re.search(
            r"```(?:json)?\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*```",
            stripped,
            re.IGNORECASE,
        )
        if fenced_match:
            candidate = fenced_match.group(1).strip()
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                pass

        # Prose + embedded JSON object.
        obj_start = stripped.find("{")
        obj_end = stripped.rfind("}")
        if obj_start != -1 and obj_end > obj_start:
            candidate = stripped[obj_start : obj_end + 1]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                pass

        # Prose + embedded JSON array.
        arr_start = stripped.find("[")
        arr_end = stripped.rfind("]")
        if arr_start != -1 and arr_end > arr_start:
            candidate = stripped[arr_start : arr_end + 1]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                pass

        return None

    def _is_user_message(self, graph_message: Any) -> bool:
        role = self._extract_message_value(graph_message, "role")
        if isinstance(role, str) and role.lower() == "user":
            return True

        message_type = self._extract_message_value(graph_message, "type")
        return isinstance(message_type, str) and message_type.lower() in {"human", "user"}

    def _is_tool_message(self, graph_message: Any) -> bool:
        message_type = self._extract_message_value(graph_message, "type")
        if message_type == "tool":
            return True
        if isinstance(graph_message, dict):
            return "tool_call_id" in graph_message
        return hasattr(graph_message, "tool_call_id")

    def _build_runtime_overrides(
        self,
        supervisor_agent_id: str | None,
        participant_agent_ids: list[str] | None,
    ) -> dict:
        """Validate and normalize optional runtime graph overrides."""
        overrides: dict[str, Any] = {}

        if supervisor_agent_id:
            try:
                normalized_supervisor_id = str(UUID(supervisor_agent_id))
            except ValueError:
                _log.warning("Ignoring invalid supervisor_agent_id: %s", supervisor_agent_id)
            else:
                overrides["supervisor_agent_id"] = normalized_supervisor_id

        if participant_agent_ids:
            normalized_participants: list[str] = []
            for participant_id in participant_agent_ids:
                try:
                    normalized_id = str(UUID(participant_id))
                except ValueError:
                    _log.warning("Ignoring invalid participant agent id: %s", participant_id)
                    continue
                if normalized_id not in normalized_participants:
                    normalized_participants.append(normalized_id)

            if normalized_participants:
                overrides["participant_agent_ids"] = normalized_participants

        return overrides

    def _build_cache_key(
        self,
        agent_id: UUID,
        conversation_id: str,
        runtime_overrides: dict[str, Any] | None,
    ) -> str:
        """Create a stable cache key that accounts for runtime overrides."""
        runtime_overrides = runtime_overrides or {}
        supervisor_id = str(runtime_overrides.get("supervisor_agent_id", ""))
        participant_ids = runtime_overrides.get("participant_agent_ids", [])
        participant_key = ",".join(sorted(cast(list[str], participant_ids)))
        tool_policy = "no-tools" if runtime_overrides.get("disable_tools") else "tools"
        return f"{agent_id}:{conversation_id}:{supervisor_id}:{participant_key}:{tool_policy}"

    def _get_or_build_graph(
        self,
        agent_id: UUID,
        conversation_id: str,
        agent_def,
        runtime_overrides: dict[str, Any] | None = None,
    ):
        runtime_overrides = runtime_overrides or {}
        cache_key = self._build_cache_key(agent_id, conversation_id, runtime_overrides)
        if cache_key not in graph_cache:
            _log.info("Building graph for agent %s, conversation %s", agent_id, conversation_id)
            try:
                if runtime_overrides:
                    graph = agent_factory.build(
                        agent_def=agent_def,
                        conversation_id=conversation_id,
                        runtime_overrides=runtime_overrides,
                    )
                else:
                    graph = agent_factory.build(agent_def, conversation_id)
            except Exception as exc:
                _log.error("Failed to build agent graph: %s", exc, exc_info=True)
                msg = f"Failed to build agent: {exc!s}"
                raise ServiceError(msg) from exc
            graph_cache[cache_key] = graph
        return graph_cache[cache_key]
