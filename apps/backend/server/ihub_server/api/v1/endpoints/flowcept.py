"""CRUD endpoints for Flowcept messages."""

from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ihub_server.api.deps import get_flowcept_service
from ihub_server.models import FlowceptMessagePublic
from ihub_server.services.errors import ConflictError, ServiceError

if TYPE_CHECKING:
    from ihub_server.services.flowcept import FlowceptService

router = APIRouter()

flowcept_service_dep = Depends(get_flowcept_service)


@router.get(
    "/broker/connect",
    tags=["Flowcept"],
    description="Create consumer and connect to S3M broker.",
    response_description="Connect to S3M Broker",
)
def connect_broker(
    req: Request,
    flowcept_service: "FlowceptService" = flowcept_service_dep,
):
    """
    Create a consumer and subscribe to S3M broker.
    """
    try:
        flowcept_service.connect_broker(req.app.state)
    except ConflictError as exc:
        return JSONResponse(content={"message": str(exc)}, status_code=400)

    return JSONResponse(
        content={"message": "Consumer created and subscribed to broker."}, status_code=200
    )


@router.delete(
    "/broker/disconnect",
    tags=["Flowcept"],
    description="Unsubcribe from broker and delete consumer.",
    response_description="Disconnected from S3M Broker",
)
def disconnect_broker(
    req: Request,
    flowcept_service: "FlowceptService" = flowcept_service_dep,
):
    """
    Unsubscribe from the Flowcept broker and delete the consumer.
    """
    try:
        flowcept_service.disconnect_broker(req.app.state)
    except ConflictError as exc:
        return JSONResponse(content={"message": str(exc)}, status_code=400)

    return JSONResponse(content={"message": "Consumer unsubscribed and deleted."}, status_code=200)


@router.get(
    "/messages",
    tags=["Flowcept"],
    description="Get Flowcept messages.",
    response_description="List of Flowcept messages.",
    response_model=list[FlowceptMessagePublic],
)
def read_messages(
    flowcept_service: "FlowceptService" = flowcept_service_dep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 20,
):
    """
    Query database and return list of Flowcpet messages.
    """
    messages = flowcept_service.list_messages(offset, limit)
    if len(messages) == 0:
        return []
    if not messages:
        raise HTTPException(status_code=404, detail="Error retrieving messages.")
    return messages


@router.get(
    "/messages/{activity_id}",
    tags=["Flowcept"],
    description="Get a Flowcept messages filtered by activity id.",
    response_description="Single acitivity specific Flowcept message.",
    response_model=list[FlowceptMessagePublic],
)
def read_message_by_activity(
    activity_id: str,
    flowcept_service: "FlowceptService" = flowcept_service_dep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 20,
):
    """
    Query database and return Flowcept messages filtered by activity id.
    """
    messages = flowcept_service.list_messages_by_activity(activity_id, offset, limit)
    if len(messages) == 0:
        return []
    if not messages:
        raise HTTPException(status_code=404, detail="Error retrieving messages.")
    return messages


class HMIMessage(BaseModel):
    """Class to define message from HMI agent"""

    content: str


@router.post(
    "/message/send",
    tags=["Flowcept"],
    description="Send a message through Flowcept.",
    response_description="Send Flowcept message.",
)
def send_message(
    message: HMIMessage,
    flowcept_service: "FlowceptService" = flowcept_service_dep,
):
    """
    Send a message to S3M broker through Flowcept.
    """
    try:
        flowcept_service.send_message(message.model_dump())
    except ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return JSONResponse(content={"message": "Flowcept message sent."}, status_code=200)


@router.post(
    "/message/hmi_agent/send/{activity_id}",
    tags=["Flowcept"],
    description="Send a Flowcept message from the HMI agent.",
    response_description="Send Flowcept message.",
)
def send_hmi_message(
    activity_id: str,
    message: HMIMessage,
    flowcept_service: "FlowceptService" = flowcept_service_dep,
):
    """
    Send a Flowcept message from HMI Agent.
    agent_id="HMI_agent", subtype="agent_task"
    """
    try:
        flowcept_service.send_hmi_message(activity_id, message.model_dump())
    except ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return JSONResponse(content={"message": "Flowcept message sent."}, status_code=200)


@router.get(
    "/broker/is_connected",
    tags=["Flowcept"],
    description="Check if Flowcept consumer connection is alive.",
    response_description="Consumer connection check.",
)
def check_connection(
    req: Request,
    flowcept_service: "FlowceptService" = flowcept_service_dep,
):
    """
    Check if Flowcept consumer is connected to the S3M broker.
    """
    try:
        return flowcept_service.check_connection(req.app.state)
    except ConflictError as exc:
        return JSONResponse(content={"message": str(exc)}, status_code=400)
