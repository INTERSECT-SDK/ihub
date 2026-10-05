"""CRUD endpoints for MCP servers."""

import logging
from typing import TYPE_CHECKING, Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from ihub_server.api.deps import (
    PrincipalDep,
    get_mcp_server_service,
)
from ihub_server.api.v1.endpoints.tools import _list_tools_for_server
from ihub_server.models import MCPServerCreate, MCPServerPublic, MCPServerUpdate
from ihub_server.services.errors import NotFoundError

if TYPE_CHECKING:
    from ihub_server.services.mcp_servers import MCPServerService

router = APIRouter()
_log = logging.getLogger("ihub-server")

mcp_service_dep = Depends(get_mcp_server_service)


@router.get(
    "/",
    tags=["MCP Servers"],
    description="Get list of MCP servers.",
    response_description="List of MCP servers",
    response_model=list[MCPServerPublic],
)
def read_mcp_servers(
    _principal: PrincipalDep,
    mcp_service: "MCPServerService" = mcp_service_dep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
    project_id: UUID | None = None,
):
    """
    Query database and return list of known MCP servers.
    """
    return mcp_service.list_mcp_servers(offset, limit, project_id)


@router.get(
    "/{mcp_id}",
    tags=["MCP Servers"],
    description="Get a single MCP server.",
    response_description="Single MCP server",
    response_model=MCPServerPublic,
)
def read_mcp_server(
    mcp_id: int,
    _principal: PrincipalDep,
    mcp_service: "MCPServerService" = mcp_service_dep,
):
    """
    Query database and return single MCP server.
    """
    try:
        return mcp_service.get_mcp_server(mcp_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/",
    tags=["MCP Servers"],
    description="Create and save MCP server to database.",
    response_description="create MCP server.",
    response_model=MCPServerPublic,
)
def create_mcp_server(
    mcp_server: MCPServerCreate,
    _principal: PrincipalDep,
    mcp_service: "MCPServerService" = mcp_service_dep,
):
    """
    Create and save MCP server to database.
    """
    return mcp_service.create_mcp_server(mcp_server)


@router.patch(
    "/{mcp_id}",
    tags=["MCP Servers"],
    description="Update a MCP server.",
    response_description="update MCP server",
    response_model=MCPServerPublic,
)
def update_mcp_server(
    mcp_id: int,
    mcp_server: MCPServerUpdate,
    _principal: PrincipalDep,
    mcp_service: "MCPServerService" = mcp_service_dep,
):
    """
    Create and save MCP server to database.
    """
    try:
        return mcp_service.update_mcp_server(mcp_id, mcp_server)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete(
    "/{mcp_id}",
    tags=["MCP Servers"],
    description="Delete MCP server from database.",
    response_description="delete MCP server",
)
def delete_mcp_server(
    mcp_id: int,
    _principal: PrincipalDep,
    mcp_service: "MCPServerService" = mcp_service_dep,
):
    """
    Delete MCP server from the database.
    """
    try:
        mcp_service.delete_mcp_server(mcp_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@router.get(
    "/{mcp_id}/tools",
    tags=["MCP Servers"],
    description="Get tool options from one configured MCP server.",
    response_description="List of MCP tool options for a server",
    response_model=list[dict],
)
async def read_mcp_server_tools(
    mcp_id: int,
    _principal: PrincipalDep,
    mcp_service: "MCPServerService" = mcp_service_dep,
) -> list[dict]:
    """Return MCP tools for one server; return empty list when unreachable."""
    try:
        mcp_server = mcp_service.get_mcp_server(mcp_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        return await _list_tools_for_server(mcp_server)
    except Exception as exc:  # noqa: BLE001
        _log.warning(
            "Failed to fetch tools for MCP server id=%s label=%s: %s",
            mcp_server.id,
            mcp_server.label,
            exc,
        )
        return []
