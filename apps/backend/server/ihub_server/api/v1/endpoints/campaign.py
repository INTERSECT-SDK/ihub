"""
Endpoints for campaign commands (e.g. start, stop, events).

The endpoints do not control the campaign. Commands are forwarded to the
INTERESECT orchestrator service.
"""

import asyncio
import logging
import secrets
from typing import TYPE_CHECKING, Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from ihub_server.api.deps import PrincipalDep, get_campaign_service
from ihub_server.models.campaign_run import (
    CampaignRun,
    CampaignRunPublic,
    CampaignRunRecovery,
    CampaignRunSnapshots,
    CampaignRunStatus,
)
from ihub_server.models.orchestrator_event import (
    OrchestratorEventCreate,
    OrchestratorEventPublic,
)
from ihub_server.services.errors import (
    NotFoundError,
    ServiceError,
    UnsupportedCampaignFormatError,
)

if TYPE_CHECKING:
    from ihub_server.services.campaign import CampaignService

router = APIRouter()

campaign_service_dep = Depends(get_campaign_service)

_log = logging.getLogger("ihub-server")


def _public_run(run: Any) -> Any:
    return CampaignRunPublic.from_run(run) if isinstance(run, CampaignRun) else run


# ---------------------------- HTTP Endpoints ------------------------------- #


@router.get(
    "/runs",
    tags=["Campaign"],
    description=(
        "Get campaign runs for the current user. Optionally filter by campaign_id, "
        "campaign_name, search term, and one or more lifecycle statuses."
    ),
    response_description="List of campaign runs.",
    response_model=list[CampaignRunPublic],
)
def list_runs(
    principal: PrincipalDep,
    campaign_id: str | None = None,
    campaign_name: str | None = None,
    search: str | None = None,
    status: Annotated[list[CampaignRunStatus] | None, Query()] = None,
    offset: int = 0,
    limit: int = 100,
    campaign_service: "CampaignService" = campaign_service_dep,
):
    """Retrieve campaign run history scoped to the current user."""
    try:
        runs = campaign_service.list_runs(
            principal.email,
            campaign_id=campaign_id,
            campaign_name=campaign_name,
            search=search,
            statuses=status,
            offset=offset,
            limit=limit,
        )
        return [_public_run(run) for run in runs]
    except ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/runs/{run_id}",
    tags=["Campaign"],
    description="Get one campaign run for the current user by orchestrator run_id.",
    response_description="Campaign run details.",
    response_model=CampaignRunPublic,
)
def get_run(
    run_id: str,
    principal: PrincipalDep,
    campaign_service: "CampaignService" = campaign_service_dep,
):
    """Retrieve one campaign run by orchestrator run_id scoped to the current user."""
    try:
        run = campaign_service.get_run_by_run_id(principal.email, run_id)
        return _public_run(run)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/runs/{run_id}/snapshots",
    tags=["Campaign"],
    description="Get the submitted and orchestrator campaign snapshots for a user-owned run.",
    response_description="Immutable campaign provenance for one run.",
    response_model=CampaignRunSnapshots,
)
def get_run_snapshots(
    run_id: str,
    principal: PrincipalDep,
    campaign_service: "CampaignService" = campaign_service_dep,
):
    """Retrieve campaign provenance scoped to the current user."""
    try:
        return campaign_service.get_run_snapshots(principal.email, run_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/runs/{run_id}/events",
    tags=["Campaign"],
    description="Get persisted events for one step of a user-owned campaign run.",
    response_description="Ordered campaign step events.",
    response_model=list[OrchestratorEventPublic],
)
def get_run_step_events(
    run_id: str,
    step_id: str,
    principal: PrincipalDep,
    before_id: Annotated[int | None, Query(ge=1)] = None,
    after_id: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    campaign_service: "CampaignService" = campaign_service_dep,
):
    """Retrieve a cursor-bounded exact-run, exact-step event page."""
    if before_id is not None and after_id is not None:
        raise HTTPException(
            status_code=422,
            detail="before_id and after_id cannot be used together.",
        )
    try:
        return campaign_service.list_run_step_events(
            principal.email,
            run_id,
            step_id,
            before_id,
            after_id,
            limit,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/runs/{run_id}/recovery",
    tags=["Campaign"],
    description="Get one user-owned campaign run and its ordered event replay.",
    response_description="Campaign run recovery snapshot.",
    response_model=CampaignRunRecovery,
)
def get_run_recovery(
    run_id: str,
    principal: PrincipalDep,
    campaign_service: "CampaignService" = campaign_service_dep,
):
    """Retrieve an exact-run recovery snapshot scoped to the current user."""
    try:
        recovery = campaign_service.get_run_recovery(principal.email, run_id)
        return {**recovery, "run": _public_run(recovery["run"])}
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{broker_id}/start",
    tags=["Campaign"],
    description="""Send a campaign to orchestrator to execute.

    Path Parameters:
    - broker_id: ID of the broker. Use the /brokers endpoint to fetch broker information.

    Body:
    - CampaignModel payload containing task_groups.
    """,
    response_description="Orchestrator status response.",
)
async def start_campaign(
    broker_id: int,
    payload: dict[str, Any],
    principal: PrincipalDep,
    campaign_service: "CampaignService" = campaign_service_dep,
):
    """
    Send a CampaignModel document to orchestrator to execute.
    """
    try:
        return await campaign_service.start_campaign(broker_id, payload, principal.email)
    except UnsupportedCampaignFormatError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{broker_id}/stop/{campaign_run_id}",
    tags=["Campaign"],
    description="""Tell orchestrator to stop the specified campaign run.
    """,
    response_description="Orchestrator status response.",
)
async def stop_campaign(
    broker_id: int,
    campaign_run_id: str,
    principal: PrincipalDep,
    campaign_service: "CampaignService" = campaign_service_dep,
):
    """
    Abort the current campaign run.

    Path Parameters:
    - campaign_run_id: run_id of the campaign run defined by the orchestrator.
    """
    try:
        return await campaign_service.stop_campaign(
            broker_id,
            campaign_run_id,
            principal.email,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/event/save",
    tags=["Campaign"],
    description="Create and save orchestrator event to database.",
    response_description="create orchestrator event.",
    response_model=OrchestratorEventPublic,
)
def create_event(
    event: OrchestratorEventCreate,
    _principal: PrincipalDep,
    campaign_service: "CampaignService" = campaign_service_dep,
):
    """
    Create and save an orchestrator event to the database.
    """
    return campaign_service.create_event(event)


@router.get(
    "/event/{event_id}",
    tags=["Campaign"],
    description="Get an orchestrator event from the database by ID.",
    response_description="Orchestrator event details.",
    response_model=OrchestratorEventPublic,
)
def get_event(
    event_id: int,
    _principal: PrincipalDep,
    campaign_service: "CampaignService" = campaign_service_dep,
):
    """
    Retrieve an orchestrator event from the database by its ID.
    """
    try:
        return campaign_service.get_event(event_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get(
    "/events",
    tags=["Campaign"],
    description="Get orchestrator events from the database. Optionally filter by campaign_id and step_id.",
    response_description="List of orchestrator events.",
    response_model=list[OrchestratorEventPublic],
)
def get_events(
    _principal: PrincipalDep,
    campaign_id: str | None = None,
    step_id: str | None = None,
    run_id: str | None = None,
    campaign_service: "CampaignService" = campaign_service_dep,
):
    """
    Retrieve orchestrator events from the database.
    Optionally filter by campaign_id, step_id, and run_id.
    """
    return campaign_service.list_events(campaign_id, step_id, run_id)


# ----------------------------- Websockets Endpoints ---------------------------- #


@router.websocket("/{broker_id}/events")
async def relay_campaign_events(
    websocket: WebSocket,
    broker_id: int,
    campaign_service: "CampaignService" = campaign_service_dep,
):
    """
    Accept a WebSocket connection and stream live campaign events from the
    orchestrator for the given broker to the connected client.
    """
    await websocket.accept()
    _log.info("Campaign websocket connected for broker %s", broker_id)
    try:
        await campaign_service.relay_campaign_events(broker_id, websocket)
    except NotFoundError as exc:
        _log.warning("Campaign websocket rejected for broker %s: %s", broker_id, exc)
        await websocket.close(code=4404, reason=str(exc))
    except ServiceError as exc:
        _log.exception("Campaign websocket relay failed for broker %s", broker_id)
        await websocket.close(code=1011, reason=str(exc))
    except WebSocketDisconnect:
        _log.info("Campaign websocket disconnected for broker %s", broker_id)


@router.websocket("/{broker_id}/mock_events/{campaign_id}")
async def random_number_stream(websocket: WebSocket):
    """
    Accept a WebSocket connection and emit mock campaign events with random
    values once per second, useful for front-end development and testing.
    """
    _log.info("WS handler entered")
    await websocket.accept()
    _log.info("WS accepted")
    n = 0
    try:
        while True:
            await websocket.send_json(
                {
                    "campaign_id": "mock_campaign",
                    "node_id": "mock_node",
                    "iteration": n,
                    "value": secrets.randbelow(100) + 1,
                }
            )
            n += 1
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass
