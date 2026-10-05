"""Endpoints for MCP tool discovery."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

from ihub_server.api.deps import get_mcp_server_service

if TYPE_CHECKING:
    from ihub_server.models import MCPServer
    from ihub_server.services.mcp_servers import MCPServerService

router = APIRouter()
_log = logging.getLogger("ihub-server")

mcp_service_dep = Depends(get_mcp_server_service)


def _serialize_input_schema(schema: Any) -> Any:
    if schema is None:
        return None
    if hasattr(schema, "model_dump"):
        return schema.model_dump()
    return schema


def _build_tool_option(mcp_server: MCPServer, tool: Any) -> dict[str, Any]:
    tool_data = tool.model_dump() if hasattr(tool, "model_dump") else {}
    tool_name = str(tool_data.get("name") or getattr(tool, "name", ""))
    tool_description = tool_data.get("description") or getattr(tool, "description", "")
    input_schema = tool_data.get("inputSchema") or tool_data.get("input_schema")
    if input_schema is None:
        input_schema = getattr(tool, "inputSchema", None) or getattr(tool, "input_schema", None)

    server_id = mcp_server.id
    value = f"mcp:{server_id}:{tool_name}"
    label = f"{mcp_server.label} / {tool_name}"

    return {
        "label": label,
        "id": value,
        "tool_name": tool_name,
        "tool_description": tool_description,
        "mcp_server_id": server_id,
        "mcp_server_label": mcp_server.label,
        "mcp_server_url": mcp_server.url,
        "input_schema": _serialize_input_schema(input_schema),
    }


async def _list_tools_for_server(mcp_server: MCPServer) -> list[dict[str, Any]]:
    mcp_url = f"{mcp_server.url}/mcp"

    headers = None
    if mcp_server.token:
        headers = {"Authorization": f"Token {mcp_server.token}"}
        _log.info(f"Using Token auth for MCP server {mcp_server.id}")

    transport = StreamableHttpTransport(mcp_url, headers=headers)
    async with Client(transport) as client:
        tools = await client.list_tools()

    return [_build_tool_option(mcp_server, tool) for tool in tools]


@router.get(
    "/",
    tags=["Tools"],
    description="Get tool options from all configured MCP servers.",
    response_description="List of MCP tool options",
    response_model=list[dict[str, Any]],
)
async def read_all_mcp_tools(
    mcp_service: MCPServerService = mcp_service_dep,
) -> list[dict[str, Any]]:
    mcp_servers = mcp_service.list_mcp_servers(offset=0, limit=1000)
    if not mcp_servers:
        return []

    results = await asyncio.gather(
        *(_list_tools_for_server(mcp_server) for mcp_server in mcp_servers),
        return_exceptions=True,
    )

    combined: list[dict[str, Any]] = []
    for mcp_server, result in zip(mcp_servers, results, strict=True):
        if isinstance(result, Exception):
            _log.warning(
                "Failed to fetch tools for MCP server id=%s label=%s: %s",
                mcp_server.id,
                mcp_server.label,
                result,
            )
            continue
        if not isinstance(result, list):
            _log.warning(
                "Unexpected tools payload for MCP server id=%s label=%s: %s",
                mcp_server.id,
                mcp_server.label,
                type(result).__name__,
            )
            continue
        combined.extend(result)

    combined.sort(
        key=lambda item: (
            str(item.get("mcp_server_label", "")).lower(),
            str(item.get("tool_name", "")).lower(),
        ),
    )
    return combined
