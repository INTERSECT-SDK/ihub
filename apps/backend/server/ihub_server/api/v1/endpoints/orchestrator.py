"""
CRUD endpoints for orchestrator

NOT USED
"""

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends

from ihub_server.api.deps import get_orchestrator_service

if TYPE_CHECKING:
    from ihub_server.services.orchestrator import OrchestratorService

router = APIRouter()

orchestrator_service_dep = Depends(get_orchestrator_service)


@router.post(
    "/start_campaign",
    tags=["Orchestrator"],
    description="Call orchestrator to start a campaign.",
    response_description="Orchestrator status response.",
)
def send_campaign_file(
    orchestrator_service: "OrchestratorService" = orchestrator_service_dep,
):
    """
    Send icmp file to orchestrator to start a campaign.
    """
    return orchestrator_service.start_campaign()


@router.post(
    "/stop_campaign",
    tags=["Orchestrator"],
    description="Call orchestrator to start a campaign.",
    response_description="Orchestrator status response.",
)
def send_abort_signal(
    orchestrator_service: "OrchestratorService" = orchestrator_service_dep,
):
    """
    Send icmp file to orchestrator to start a campaign.
    """
    return orchestrator_service.stop_campaign()


@router.get(
    "/events",
    tags=["Orchestrator"],
    description="Call orchestrator to start a campaign.",
    response_description="Orchestrator status response.",
)
def listen_for_events(
    orchestrator_service: "OrchestratorService" = orchestrator_service_dep,
):
    """
    Send icmp file to orchestrator to start a campaign.
    """
    return orchestrator_service.listen_for_events()
