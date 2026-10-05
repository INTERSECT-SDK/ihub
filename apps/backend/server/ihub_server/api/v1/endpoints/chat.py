"""Chat endpoints for Agent interaction."""

from __future__ import annotations

import base64
import binascii
import logging
from typing import TYPE_CHECKING, Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from ihub_server.api.deps import Principal, PrincipalDep, get_chat_service
from ihub_server.db import validate_user_session
from ihub_server.services.errors import ForbiddenError, NotFoundError, ServiceError

if TYPE_CHECKING:
    from ihub_server.services.chat import ChatService

router = APIRouter()

_log = logging.getLogger("ihub-server")

chat_service_dep = Depends(get_chat_service)

MAX_CHAT_ATTACHMENT_COUNT = 5
MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024


class ChatAttachment(BaseModel):
    """A base64-encoded file attached to a user chat turn."""

    name: str
    mime_type: str = Field(alias="mimeType")
    size: int = Field(gt=0, le=MAX_CHAT_ATTACHMENT_BYTES)
    data: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        name = value.strip()
        if not name or len(name) > 255 or name in {".", ".."} or "/" in name or "\\" in name:
            msg = "Attachment name must be a plain filename up to 255 characters."
            raise ValueError(msg)
        return name

    @field_validator("mime_type")
    @classmethod
    def validate_mime_type(cls, value: str) -> str:
        mime_type = value.strip().lower()
        if not mime_type or len(mime_type) > 127:
            msg = "Attachment MIME type is invalid."
            raise ValueError(msg)
        return mime_type

    @model_validator(mode="after")
    def validate_encoded_size(self) -> ChatAttachment:
        try:
            decoded = base64.b64decode(self.data, validate=True)
        except (binascii.Error, ValueError) as exc:
            msg = "Attachment data must be valid base64."
            raise ValueError(msg) from exc

        if len(decoded) != self.size:
            msg = "Attachment size does not match its decoded data."
            raise ValueError(msg)
        return self


class ChatTextContent(BaseModel):
    """Text within a rich user message."""

    type: Literal["text"]
    text: str


class ChatAttachmentContent(BaseModel):
    """Attachment within a rich user message."""

    type: Literal["attachment"]
    attachment: ChatAttachment


ChatMessageContent = Annotated[
    ChatTextContent | ChatAttachmentContent,
    Field(discriminator="type"),
]


class MessageItem(BaseModel):
    """A single message in conversation history."""

    role: str  # "user" or "assistant"
    content: str | list[ChatMessageContent]
    sender_id: str | None = Field(default=None, alias="senderId")


class ChatRequest(BaseModel):
    """Request to chat with an agent."""

    conversation_id: str
    messages: list[MessageItem] = Field(default_factory=list)
    message: str  # New message from user
    attachments: list[ChatAttachment] = Field(default_factory=list)
    supervisor_agent_id: str | None = None
    participant_agent_ids: list[str] | None = None

    @model_validator(mode="after")
    def validate_attachments(self) -> ChatRequest:
        if len(self.attachments) > MAX_CHAT_ATTACHMENT_COUNT:
            msg = f"A message can include at most {MAX_CHAT_ATTACHMENT_COUNT} attachments."
            raise ValueError(msg)
        if sum(attachment.size for attachment in self.attachments) > MAX_CHAT_ATTACHMENT_BYTES:
            msg = "Attachments can total up to 10 MB per message."
            raise ValueError(msg)
        if not self.message.strip() and not self.attachments:
            msg = "A message or attachment is required."
            raise ValueError(msg)
        return self


class ChatSocketSessionStart(BaseModel):
    """Open or restore a conversation session over websocket."""

    type: Literal["session.start"]
    conversation_id: str = Field(alias="conversationId")
    supervisor_agent_id: str | None = Field(default=None, alias="supervisorAgentId")
    participant_agent_ids: list[str] | None = Field(
        default=None,
        alias="participantAgentIds",
    )


class ChatSocketUserMessage(BaseModel):
    """Submit a user turn over websocket."""

    type: Literal["user.message"]
    conversation_id: str = Field(alias="conversationId")
    message: str
    messages: list[MessageItem] = Field(default_factory=list)
    attachments: list[ChatAttachment] = Field(default_factory=list)
    supervisor_agent_id: str | None = Field(default=None, alias="supervisorAgentId")
    participant_agent_ids: list[str] | None = Field(
        default=None,
        alias="participantAgentIds",
    )

    @model_validator(mode="after")
    def validate_attachments(self) -> ChatSocketUserMessage:
        if len(self.attachments) > MAX_CHAT_ATTACHMENT_COUNT:
            msg = f"A message can include at most {MAX_CHAT_ATTACHMENT_COUNT} attachments."
            raise ValueError(msg)
        if sum(attachment.size for attachment in self.attachments) > MAX_CHAT_ATTACHMENT_BYTES:
            msg = "Attachments can total up to 10 MB per message."
            raise ValueError(msg)
        if not self.message.strip() and not self.attachments:
            msg = "A message or attachment is required."
            raise ValueError(msg)
        return self


class ChatSocketPromptResponse(BaseModel):
    """Provide a response to a pending prompt request."""

    type: Literal["user.prompt_response"]
    conversation_id: str = Field(alias="conversationId")
    prompt_id: str = Field(alias="promptId")
    response: str | bool | list[str]


class ChatSocketConversationClear(BaseModel):
    """Clear cached conversation state."""

    type: Literal["conversation.clear"]
    conversation_id: str = Field(alias="conversationId")
    participant_agent_ids: list[str] | None = Field(
        default=None,
        alias="participantAgentIds",
    )


class ChatResponse(BaseModel):
    """Response from agent chat."""

    response: str
    conversation_id: str


@router.post(
    "/{agent_id}",
    tags=["Chat"],
    description="Chat with an agent.",
    response_description="Agent's response.",
    response_model=ChatResponse,
)
def chat(
    agent_id: UUID,
    request: ChatRequest,
    _principal: PrincipalDep,
    chat_service: ChatService = chat_service_dep,
):
    """
    Chat with an agent specified by agent_id.
    Maintains conversation history across multiple messages.

    Args:
        agent_id: UUID of the agent from database
        request: Chat request with message and conversation_id

    Returns:
        Agent's response

    Raises:
        HTTPException: If agent not found or graph execution fails
    """
    try:
        response_text = chat_service.chat(
            agent_id,
            request.conversation_id,
            request.messages,
            request.message,
            request.supervisor_agent_id,
            request.participant_agent_ids,
            request.attachments,
        )
        _log.info("Agent response: %s...", response_text[:100])
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return ChatResponse(
        response=response_text,
        conversation_id=request.conversation_id,
    )


@router.delete(
    "/{agent_id}/{conversation_id}",
    tags=["Chat"],
    description="Clear conversation history for an agent.",
)
def clear_conversation(
    agent_id: UUID,
    conversation_id: str,
    _principal: PrincipalDep,
    chat_service: ChatService = chat_service_dep,
):
    """Clear cached graph for a conversation."""
    chat_service.clear_conversation(agent_id, conversation_id)
    return {"detail": "Conversation cleared."}


async def _get_websocket_principal(websocket: WebSocket) -> Principal | None:
    session_id = websocket.cookies.get("IHUB_SESSION")
    if not session_id:
        return None
    user = await websocket.app.state.redis.json().get(session_id)
    user = validate_user_session(user)
    if user is None:
        return None
    subject_id = str(user.get("subject_id") or user.get("sub") or "").strip()
    email = str(user.get("email") or "").strip().lower()
    return Principal(subject_id=subject_id, email=email)


@router.websocket("/ws/{agent_id}")
async def chat_stream(
    websocket: WebSocket,
    agent_id: str,
    chat_service: ChatService = chat_service_dep,
):
    """Stream chat events over websocket for a single agent room."""
    principal = await _get_websocket_principal(websocket)
    if principal is None:
        await websocket.close(code=4401, reason="Unauthorized")
        return

    is_remote_agent = False
    remote_agent_id: int | None = None
    remote_runtime_agent_id: str | None = None
    local_agent_id: UUID | None = None

    if agent_id.startswith("remote:"):
        parts = agent_id.split(":", 2)
        if len(parts) != 3:
            await websocket.close(code=4400, reason="Invalid remote agent identifier")
            return
        try:
            remote_agent_id = int(parts[1])
        except ValueError:
            await websocket.close(code=4400, reason="Invalid remote agent id")
            return
        remote_runtime_agent_id = parts[2]
        is_remote_agent = True
    else:
        try:
            local_agent_id = UUID(agent_id)
        except ValueError:
            await websocket.close(code=4400, reason="Invalid agent identifier")
            return

    await websocket.accept()
    _log.info("Chat websocket connected for agent %s", agent_id)

    try:
        while True:
            try:
                payload = await websocket.receive_json()
                event_type = payload.get("type")

                if event_type == "session.start":
                    session_start = ChatSocketSessionStart.model_validate(payload)
                    await websocket.send_json(
                        {
                            "type": "session.ready",
                            "conversationId": session_start.conversation_id,
                        },
                    )
                    continue

                if event_type == "conversation.clear":
                    conversation_clear = ChatSocketConversationClear.model_validate(payload)
                    if is_remote_agent and remote_agent_id is not None:
                        chat_service.clear_remote_agent_conversation(
                            remote_agent_id,
                            conversation_clear.conversation_id,
                        )
                    elif local_agent_id is not None:
                        chat_service.clear_mixed_group_conversation(
                            local_agent_id,
                            conversation_clear.conversation_id,
                            conversation_clear.participant_agent_ids or [],
                        )
                    await websocket.send_json(
                        {
                            "type": "conversation.cleared",
                            "conversationId": conversation_clear.conversation_id,
                        },
                    )
                    continue

                if event_type == "user.prompt_response":
                    prompt_response = ChatSocketPromptResponse.model_validate(payload)
                    await websocket.send_json(
                        {
                            "type": "error",
                            "conversationId": prompt_response.conversation_id,
                            "error": "Prompt responses are not wired to graph resume yet.",
                        },
                    )
                    continue

                if event_type == "user.message":
                    user_message = ChatSocketUserMessage.model_validate(payload)
                    await websocket.send_json(
                        {
                            "type": "session.ready",
                            "conversationId": user_message.conversation_id,
                        },
                    )
                    if is_remote_agent and remote_agent_id is not None and remote_runtime_agent_id:
                        async for stream_event in chat_service.stream_remote_agent_events(
                            remote_sender_id=agent_id,
                            remote_agent_server_id=remote_agent_id,
                            remote_agent_id=remote_runtime_agent_id,
                            conversation_id=user_message.conversation_id,
                            messages=user_message.messages,
                            message=user_message.message,
                            attachments=user_message.attachments,
                        ):
                            await websocket.send_json(stream_event)
                    elif local_agent_id is not None:
                        async for stream_event in chat_service.stream_chat_events(
                            local_agent_id,
                            user_message.conversation_id,
                            user_message.messages,
                            user_message.message,
                            user_message.supervisor_agent_id,
                            user_message.participant_agent_ids,
                            user_message.attachments,
                        ):
                            await websocket.send_json(stream_event)
                    continue

                await websocket.send_json(
                    {
                        "type": "error",
                        "conversationId": payload.get("conversationId", ""),
                        "error": f"Unsupported websocket event type: {event_type}",
                    },
                )
            except ValidationError as exc:
                await websocket.send_json(
                    {
                        "type": "error",
                        "conversationId": "",
                        "error": str(exc),
                    },
                )
    except WebSocketDisconnect:
        _log.info("Chat websocket disconnected for agent %s", agent_id)
