"""CRUD endpoints for remote agent configurations."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from ihub_server.api.deps import (
    PrincipalDep,
    get_remote_agent_service,
)
from ihub_server.models import (
    RemoteAgentPublic,
    RemoteAgentServerCreate,
    RemoteAgentServerPublic,
    RemoteAgentServerUpdate,
)
from ihub_server.services.errors import NotFoundError

if TYPE_CHECKING:
    from ihub_server.services.remote_agent_servers import RemoteAgentServerService

router = APIRouter()

remote_agent_service_dep = Depends(get_remote_agent_service)


@router.get(
    "/",
    tags=["Remote Agent Servers"],
    description="Get list of remote agent server configurations.",
    response_description="List of remote agent servers",
    response_model=list[RemoteAgentServerPublic],
)
def read_remote_agent_servers(
    _principal: PrincipalDep,
    remote_agent_service: RemoteAgentServerService = remote_agent_service_dep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
):
    """Query database and return list of configured remote agent servers."""
    return remote_agent_service.list_remote_agent_servers(offset, limit)


@router.get(
    "/agents",
    tags=["Remote Agent Servers"],
    description="Get list of discovered remote agents across all configured remote servers.",
    response_description="List of discovered remote agents",
    response_model=list[RemoteAgentPublic],
)
def read_remote_agents(
    _principal: PrincipalDep,
    remote_agent_service: RemoteAgentServerService = remote_agent_service_dep,
    offset: int = 0,
    limit: Annotated[int, Query(le=500)] = 500,
):
    """List discovered remote agents synced from all remote servers."""
    return remote_agent_service.list_remote_agents(offset, limit)


@router.post(
    "/sync-agents",
    tags=["Remote Agent Servers"],
    description="Sync discovered remote agents from every configured remote server.",
)
def sync_all_remote_agents(
    _principal: PrincipalDep,
    remote_agent_service: RemoteAgentServerService = remote_agent_service_dep,
):
    """Synchronize discovered remote agents for all configured remote agent servers."""
    return remote_agent_service.sync_all_remote_agents()


@router.get(
    "/{remote_agent_id}",
    tags=["Remote Agent Servers"],
    description="Get a single remote agent server configuration.",
    response_description="Single remote agent server",
    response_model=RemoteAgentServerPublic,
)
def read_remote_agent(
    remote_agent_id: int,
    _principal: PrincipalDep,
    remote_agent_service: RemoteAgentServerService = remote_agent_service_dep,
):
    """Query database and return one remote agent server by id."""
    try:
        return remote_agent_service.get_remote_agent(remote_agent_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/",
    tags=["Remote Agent Servers"],
    description="Create and save a remote agent server configuration.",
    response_description="Created remote agent server",
    response_model=RemoteAgentServerPublic,
)
def create_remote_agent(
    remote_agent: RemoteAgentServerCreate,
    _principal: PrincipalDep,
    remote_agent_service: RemoteAgentServerService = remote_agent_service_dep,
):
    """Create and persist a remote agent server config."""
    return remote_agent_service.create_remote_agent(remote_agent)


@router.patch(
    "/{remote_agent_id}",
    tags=["Remote Agent Servers"],
    description="Update a remote agent server configuration.",
    response_description="Updated remote agent server",
    response_model=RemoteAgentServerPublic,
)
def update_remote_agent(
    remote_agent_id: int,
    remote_agent: RemoteAgentServerUpdate,
    _principal: PrincipalDep,
    remote_agent_service: RemoteAgentServerService = remote_agent_service_dep,
):
    """Update a remote agent server config."""
    try:
        return remote_agent_service.update_remote_agent(remote_agent_id, remote_agent)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete(
    "/{remote_agent_id}",
    tags=["Remote Agent Servers"],
    description="Delete remote agent server configuration from database.",
)
def delete_remote_agent(
    remote_agent_id: int,
    _principal: PrincipalDep,
    remote_agent_service: RemoteAgentServerService = remote_agent_service_dep,
):
    """Delete a remote agent server config from the database."""
    try:
        remote_agent_service.delete_remote_agent(remote_agent_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@router.post(
    "/{remote_agent_id}/agents/sync",
    tags=["Remote Agent Servers"],
    description="Sync discovered remote agents for one remote server.",
    response_model=list[RemoteAgentPublic],
)
def sync_remote_agents(
    remote_agent_id: int,
    _principal: PrincipalDep,
    remote_agent_service: RemoteAgentServerService = remote_agent_service_dep,
):
    """Synchronize discovered remote agents for a specific remote server."""
    try:
        return remote_agent_service.sync_remote_agents(remote_agent_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get(
    "/{remote_agent_id}/agents",
    tags=["Remote Agent Servers"],
    description="List discovered remote agents for one remote server.",
    response_model=list[RemoteAgentPublic],
)
def read_remote_agents_for_remote_agent_server(
    remote_agent_id: int,
    _principal: PrincipalDep,
    remote_agent_service: RemoteAgentServerService = remote_agent_service_dep,
):
    """List discovered remote agents for a specific remote server."""
    try:
        return remote_agent_service.list_remote_agents_for_remote_agent_server(
            remote_agent_id,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/{remote_agent_id}/health-check",
    tags=["Remote Agent Servers"],
    description="Validate remote agent server connectivity and configured remote agent.",
)
def health_check_remote_agent(
    remote_agent_id: int,
    _principal: PrincipalDep,
    remote_agent_service: RemoteAgentServerService = remote_agent_service_dep,
):
    """Run a connectivity check against the configured remote agent server."""
    try:
        return remote_agent_service.health_check(remote_agent_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
