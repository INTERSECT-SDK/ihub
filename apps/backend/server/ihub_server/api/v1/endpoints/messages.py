"""Endpoints for broker messages"""

import logging
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, Query, Request
from sse_starlette.sse import EventSourceResponse, ServerSentEvent

from ihub_server.api.deps import get_lifecycle_message_service
from ihub_server.models import LifecycleMessagePublic

if TYPE_CHECKING:
    from ihub_server.services.lifecycle import LifecycleMessageService
    from ihub_server.services.lifecycle_message_stream import LifecycleMessageStreamManager

router = APIRouter()

lifecycle_service_dep = Depends(get_lifecycle_message_service)

_log = logging.getLogger(__name__)


@router.get(
    "/stream",
    tags=["Messages"],
    description="Listen for valid lifecycle messages from all connected brokers",
    response_description="Lifecycle message sent through a broker",
)
async def subscribe_to_messages(req: Request):
    """
    This is a Server-Sent-Event endpoint.

    NOTE: In SSEs, all messages MUST be valid UTF-8 (so no binary images, for example).
    Lifecycle envelopes are serialized as UTF-8 JSON data frames.
    """

    manager: LifecycleMessageStreamManager = req.app.state.lifecycle_message_stream

    async def event_publisher():
        async with manager.subscribe() as queue:
            while True:
                msg = await queue.get()
                if not isinstance(msg, str):
                    return
                _log.debug("Emitting message: %s", msg)
                yield ServerSentEvent(data=msg)

    return EventSourceResponse(event_publisher(), ping=15)


@router.get(
    "/lifecycle/{broker_id}",
    tags=["Messages"],
    description="Get list of lifecyle messages from a broker.",
    response_description="List of lifecycle messages.",
    response_model=list[LifecycleMessagePublic],
)
def read_lifecycle_messages(
    broker_id: int,
    lifecycle_service: "LifecycleMessageService" = lifecycle_service_dep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
):
    """
    Query database and return list of lifecycle messages from a specific broker.
    """
    return lifecycle_service.list_messages(broker_id, offset, limit)


@router.get(
    "/lifecycle",
    tags=["Messages"],
    description="Get list of lifecyle messages from all broker.",
    response_description="List of all lifecycle messages.",
    response_model=list[LifecycleMessagePublic],
)
def read_all_lifecycle_messages(
    lifecycle_service: "LifecycleMessageService" = lifecycle_service_dep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
):
    """
    Query database and return list of lifecycle messages from a all brokers.
    """
    return lifecycle_service.list_messages(None, offset, limit)
