"""CRUD endpoints for message brokers"""

import logging
from typing import TYPE_CHECKING, Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ihub_server.api.deps import (
    PrincipalDep,
    get_broker_connection_service,
    get_broker_orchestrator_health_service,
    get_broker_service,
)
from ihub_server.models import (
    Broker,
    BrokerCreate,
    BrokerPublic,
    BrokerUpdate,
    OrchestratorHealth,
)
from ihub_server.services.errors import (
    BrokerConnectionError,
    ConflictError,
    NotFoundError,
)

if TYPE_CHECKING:
    from ihub_server.services.brokers import (
        BrokerConnectionService,
        BrokerOrchestratorHealthService,
        BrokerService,
    )

router = APIRouter()

broker_service_dep = Depends(get_broker_service)
broker_connection_service_dep = Depends(get_broker_connection_service)
broker_orchestrator_health_service_dep = Depends(get_broker_orchestrator_health_service)

_log = logging.getLogger("ihub-server")


@router.get(
    "/",
    tags=["Brokers"],
    description="Get list of known brokers.",
    response_description="List of known brokers",
    response_model=list[BrokerPublic],
)
def read_brokers(
    _principal: PrincipalDep,
    broker_service: "BrokerService" = broker_service_dep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
    project_id: UUID | None = None,
):
    """
    Query database and return list of known brokers.
    """
    return broker_service.list_brokers(offset, limit, project_id)


@router.get(
    "/{broker_id}",
    tags=["Brokers"],
    description="Get a single broker.",
    response_description="Single broker",
    response_model=BrokerPublic,
)
def read_broker(
    broker_id: int,
    _principal: PrincipalDep,
    broker_service: "BrokerService" = broker_service_dep,
):
    """
    Query database and return single broker.
    """
    try:
        return broker_service.get_broker(broker_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get(
    "/{broker_id}/orchestrator-health",
    tags=["Brokers"],
    description="Check a broker's configured orchestrator health.",
    response_description="Current orchestrator health",
    response_model=OrchestratorHealth,
)
async def read_orchestrator_health(
    broker_id: int,
    _principal: PrincipalDep,
    health_service: "BrokerOrchestratorHealthService" = broker_orchestrator_health_service_dep,
) -> OrchestratorHealth:
    """Probe the configured orchestrator without changing persisted broker state."""
    try:
        status = await health_service.check(broker_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return OrchestratorHealth(status=status)


@router.post(
    "/",
    tags=["Brokers"],
    description="Create and save broker to database.",
    response_description="create broker.",
    response_model=BrokerPublic,
)
def create_broker(
    broker: BrokerCreate,
    _principal: PrincipalDep,
    broker_service: "BrokerService" = broker_service_dep,
):
    """
    Create and save broker to database.
    """
    return broker_service.create_broker(broker)


@router.patch(
    "/{broker_id}",
    tags=["Brokers"],
    description="Update a broker.",
    response_description="update broker",
    response_model=BrokerPublic,
)
def update_broker(
    broker_id: int,
    broker: BrokerUpdate,
    _principal: PrincipalDep,
    broker_service: "BrokerService" = broker_service_dep,
) -> Broker:
    """
    Create and save broker to database.
    """
    try:
        return broker_service.update_broker(broker_id, broker)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete(
    "/{broker_id}",
    tags=["Brokers"],
    description="Delete broker from database.",
    response_description="delete broker",
)
def delete_broker(
    broker_id: int,
    _principal: PrincipalDep,
    broker_service: "BrokerService" = broker_service_dep,
):
    """
    Delete broker from the database.
    """
    try:
        broker_service.delete_broker(broker_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@router.patch(
    "/connect/{broker_id}",
    tags=["Brokers"],
    description="Connect to a broker to start receiving messages.",
    response_description="Connect to a broker.",
    response_model=BrokerPublic,
)
def connect_broker(
    req: Request,
    broker_id: int,
    _principal: PrincipalDep,
    connection_service: "BrokerConnectionService" = broker_connection_service_dep,
):
    """
    Connect to a broker and begin receiving messages (e.g. lifecyle messages).
    """
    try:
        updated_broker = connection_service.connect_broker(
            broker_id, req.app.state.intersect_clients
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except BrokerConnectionError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    _log.info(
        "Updated broker %s (%s) status to 'connected'.",
        broker_id,
        updated_broker.label,
    )
    return updated_broker


@router.delete(
    "/disconnect/{broker_id}",
    tags=["Brokers"],
    description="Disconnect to a broker to stop receiving messages.",
    response_description="Disconnect to a broker.",
    response_model=BrokerPublic,
)
def disconnect_broker(
    req: Request,
    broker_id: int,
    _principal: PrincipalDep,
    connection_service: "BrokerConnectionService" = broker_connection_service_dep,
):
    """
    Connect to a broker and begin receiving messages (e.g. lifecyle messages).
    """
    try:
        updated_broker = connection_service.disconnect_broker(
            broker_id, req.app.state.intersect_clients
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    _log.info(
        "Updated broker %s (%s) status to 'disconnected'.",
        broker_id,
        updated_broker.label,
    )
    return updated_broker
