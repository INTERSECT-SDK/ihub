"""CRUD endpoints for Agent definitions."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated
from uuid import UUID  # noqa: TC003

from fastapi import APIRouter, Depends, HTTPException, Query

from ihub_server.api.deps import PrincipalDep, get_agent_service
from ihub_server.models import AgentCreate, AgentPublic, AgentUpdate
from ihub_server.services.errors import NotFoundError

if TYPE_CHECKING:
    from ihub_server.services.agents import AgentService

router = APIRouter()

agent_service_dep = Depends(get_agent_service)


@router.get(
    "/",
    tags=["Agents"],
    description="Get list of Agent definitions.",
    response_description="List of Agents",
    response_model=list[AgentPublic],
)
def read_agents(
    _principal: PrincipalDep,
    agent_service: AgentService = agent_service_dep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
    project_id: UUID | None = None,
):
    """
    Query database and return list of known agents.
    """
    return agent_service.list_agents(offset, limit, project_id)


@router.get(
    "/{agent_id}",
    tags=["Agents"],
    description="Get a single Agent definition.",
    response_description="The requested Agent.",
    response_model=AgentPublic,
)
def read_agent(
    agent_id: UUID,
    _principal: PrincipalDep,
    agent_service: AgentService = agent_service_dep,
):
    """
    Query database and return one agent by id.
    """
    try:
        return agent_service.get_agent(agent_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/",
    tags=["Agents"],
    description="Add a new Agent definition.",
    response_description="The created Agent.",
    response_model=AgentPublic,
)
def create_agent(
    agent: AgentCreate,
    _principal: PrincipalDep,
    agent_service: AgentService = agent_service_dep,
):
    """
    Add a new Agent to the database.
    """
    return agent_service.create_agent(agent)


@router.delete(
    "/{agent_id}",
    tags=["Agents"],
    description="Delete an Agent definition.",
)
def delete_agent(
    agent_id: UUID,
    _principal: PrincipalDep,
    agent_service: AgentService = agent_service_dep,
):
    """
    Delete an Agent from the database.
    """
    try:
        agent_service.delete_agent(agent_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"detail": "Agent deleted."}


@router.patch(
    "/{agent_id}",
    tags=["Agents"],
    description="Update an Agent definition.",
    response_description="The updated Agent.",
    response_model=AgentPublic,
)
def update_agent(
    agent_id: UUID,
    agent_update: AgentUpdate,
    _principal: PrincipalDep,
    agent_service: AgentService = agent_service_dep,
):
    """
    Update an Agent in the database.
    """
    try:
        return agent_service.update_agent(agent_id, agent_update)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
