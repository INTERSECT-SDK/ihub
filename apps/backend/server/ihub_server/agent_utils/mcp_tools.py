"""MCP tool integration for agent tool registry."""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, cast

from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from langchain_core.tools import StructuredTool
from sqlmodel import Session

from ihub_server.db import engine
from ihub_server.models import MCPServer

_log = logging.getLogger("ihub-server")

# Common non-tool metadata keys frequently hallucinated by LLM tool calls.
_DISALLOWED_META_ARGS = {
    "agent",
    "agent_id",
    "args",
    "arguments",
    "assistant",
    "content",
    "from",
    "id",
    "label",
    "mcp",
    "mcp_server_id",
    "mcp_server_label",
    "mcp_server_url",
    "message",
    "server",
    "server_id",
    "server_name",
    "to",
    "tool",
    "tool_call_id",
    "tool_choice",
    "tool_id",
    "tool_name",
}


def _extract_content_text(content_item: Any) -> str | None:
    if isinstance(content_item, str):
        return content_item

    text_value = getattr(content_item, "text", None)
    if isinstance(text_value, str):
        return text_value

    return None


def _serialize_content_block(content_item: Any) -> Any:
    """Convert an MCP content block to JSON-compatible protocol data."""
    if hasattr(content_item, "model_dump"):
        return content_item.model_dump(mode="json", by_alias=True)
    if isinstance(content_item, dict | list | str | int | float | bool) or content_item is None:
        return content_item
    return str(content_item)


def _serialize_mcp_result(result: Any) -> dict[str, Any]:
    """Preserve typed MCP content for downstream chat rendering."""
    content = getattr(result, "content", [])
    return {
        "content": [_serialize_content_block(item) for item in content],
        "structuredContent": getattr(result, "structured_content", None),
        "isError": bool(getattr(result, "is_error", False)),
    }


def _build_model_tool_text(result: Any) -> str:
    """Return only text content to the model; rich content stays in the artifact."""
    text_segments = [
        text for item in getattr(result, "content", []) if (text := _extract_content_text(item))
    ]
    if text_segments:
        return "\n".join(text_segments)
    return "Tool returned rich content for display."


def _extract_tool_input_schema(tool: Any) -> dict[str, Any] | None:
    """Extract a tool input schema from fastmcp tool objects."""
    tool_data = tool.model_dump() if hasattr(tool, "model_dump") else {}
    input_schema = tool_data.get("inputSchema") or tool_data.get("input_schema")
    if input_schema is None:
        input_schema = getattr(tool, "inputSchema", None) or getattr(tool, "input_schema", None)

    if not isinstance(input_schema, dict):
        return None
    return cast(dict[str, Any], input_schema)


async def call_mcp_tool(
    mcp_server: MCPServer,
    tool_name: str,
    tool_input: dict[str, Any],
) -> tuple[str, dict[str, Any]]:
    """Call a tool on an MCP server.

    Args:
        mcp_server: MCP server configuration from database
        tool_name: Name of the tool to call
        tool_input: Input arguments for the tool

    Returns:
        Model-facing text and the complete MCP result as a LangChain artifact
    """
    mcp_url = f"{mcp_server.url}/mcp"
    _log.info(f"Calling tool '{tool_name}' on MCP server at {mcp_url}")

    try:
        headers = {"Authorization": f"Token {mcp_server.token}"} if mcp_server.token else None
        if mcp_server.token:
            _log.info(f"Using token auth for MCP server {mcp_server.id}")
        transport = StreamableHttpTransport(mcp_url, headers=headers)
        async with Client(transport) as client:
            result = await client.call_tool(tool_name, arguments=tool_input)
            return _build_model_tool_text(result), _serialize_mcp_result(result)
    except Exception as e:
        _log.error(f"Failed to call MCP tool '{tool_name}': {e}")
        raise


def get_mcp_tool_schema(
    mcp_server_id: int,
    tool_name: str,
) -> dict[str, Any] | None:
    """Fetch input schema for one MCP tool from a configured server."""
    with Session(engine) as session:
        mcp_server = session.get(MCPServer, mcp_server_id)
        if not mcp_server:
            msg = f"MCP server with id {mcp_server_id} not found"
            raise ValueError(msg)

        async def fetch_schema() -> dict[str, Any] | None:
            mcp_url = f"{mcp_server.url}/mcp"
            headers = {"Authorization": f"Token {mcp_server.token}"} if mcp_server.token else None
            transport = StreamableHttpTransport(mcp_url, headers=headers)
            async with Client(transport) as client:
                tools = await client.list_tools()

            for tool in tools:
                candidate_name = getattr(tool, "name", None)
                if not candidate_name and hasattr(tool, "model_dump"):
                    candidate_name = tool.model_dump().get("name")
                if str(candidate_name) == tool_name:
                    return _extract_tool_input_schema(tool)

            return None

        def run_async_in_thread() -> dict[str, Any] | None:
            return asyncio.run(fetch_schema())

        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(run_async_in_thread)
            return future.result(timeout=30)


def _sanitize_tool_input(
    tool_input: dict[str, Any],
    tool_schema: dict[str, Any] | None,
) -> dict[str, Any]:
    """Remove metadata/hallucinated kwargs before calling an MCP tool.

    If schema properties are known, keep only declared keys. Otherwise, strip
    common non-tool metadata fields that LLMs may inject.
    """
    if not tool_input:
        return {}

    if tool_schema:
        schema_properties = tool_schema.get("properties")
        if isinstance(schema_properties, dict):
            allowed_keys = {str(key) for key in schema_properties}
            filtered = {
                key: value
                for key, value in tool_input.items()
                if key in allowed_keys and value is not None
            }
            if filtered != tool_input:
                dropped_keys = sorted(set(tool_input.keys()) - set(filtered.keys()))
                if dropped_keys:
                    _log.info(
                        "Dropped non-schema args for MCP tool call: %s",
                        ", ".join(dropped_keys),
                    )
            return filtered

    filtered = {
        key: value
        for key, value in tool_input.items()
        if key not in _DISALLOWED_META_ARGS and value is not None
    }
    if filtered != tool_input:
        dropped_keys = sorted(set(tool_input.keys()) - set(filtered.keys()))
        if dropped_keys:
            _log.info(
                "Dropped metadata args for MCP tool call: %s",
                ", ".join(dropped_keys),
            )
    return filtered


def create_mcp_tool(
    mcp_server_id: int,
    tool_name: str,
    tool_description: str = "",
    tool_schema: dict[str, Any] | None = None,
) -> StructuredTool:
    """Create a LangChain StructuredTool from an MCP tool.

    Args:
        mcp_server_id: ID of the MCP server in the database
        tool_name: Name of the tool on the MCP server
        tool_description: Description of what the tool does
        tool_schema: JSON schema for tool input validation

    Returns:
        LangChain StructuredTool ready for use in an agent

    Raises:
        ValueError: If MCP server not found
    """
    # Fetch MCP server config from database
    with Session(engine) as session:
        mcp_server = session.get(MCPServer, mcp_server_id)
        if not mcp_server:
            msg = f"MCP server with id {mcp_server_id} not found"
            raise ValueError(msg)

        # Create wrapper function
        def call_tool(
            **kwargs: Any,
        ) -> tuple[str, dict[str, Any]]:
            """Wrapper function that bridges MCP tool to LangChain (sync version).

            This function will be called by the agent when the tool is invoked
            in a synchronous context. It safely runs the async MCP call in a thread.
            """
            sanitized_kwargs = _sanitize_tool_input(kwargs, tool_schema)

            # Use a thread pool to safely run the async call without event loop conflicts
            def run_async_in_thread():
                return asyncio.run(
                    call_mcp_tool(mcp_server, tool_name, sanitized_kwargs),
                )

            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(run_async_in_thread)
                return future.result(timeout=60)

        async def acall_tool(
            **kwargs: Any,
        ) -> tuple[str, dict[str, Any]]:
            """Wrapper function that bridges MCP tool to LangChain (async version).

            This function will be called by the agent when the tool is invoked
            in an async context.
            """
            sanitized_kwargs = _sanitize_tool_input(kwargs, tool_schema)
            return await call_mcp_tool(mcp_server, tool_name, sanitized_kwargs)

        # Build tool schema for LangChain
        tool_args_schema = tool_schema or {"type": "object", "properties": {}}

        # Create and return LangChain tool with both sync and async implementations
        tool = StructuredTool.from_function(
            func=call_tool,
            coroutine=acall_tool,
            name=tool_name,
            description=tool_description or f"MCP tool: {tool_name}",
            args_schema=tool_args_schema,  # type: ignore[arg-type]
            response_format="content_and_artifact",
        )

        _log.info(
            f"Created MCP tool '{tool_name}' for server {mcp_server_id} at {mcp_server.url}",
        )
        return tool


def parse_mcp_tool_id(tool_id: str) -> tuple[int, str] | None:
    """Parse an MCP tool ID in format 'mcp:SERVER_ID:TOOL_NAME'.

    Args:
        tool_id: Tool ID string in format 'mcp:SERVER_ID:TOOL_NAME'

    Returns:
        Tuple of (server_id, tool_name) or None if format invalid

    Examples:
        >>> parse_mcp_tool_id("mcp:13:say_hello")
        (13, "say_hello")
        >>> parse_mcp_tool_id("mcp:1:tool_with_name")
        (1, "tool_with_name")
    """
    parts = tool_id.split(":", 2)
    if len(parts) != 3 or parts[0] != "mcp":
        return None

    try:
        server_id = int(parts[1])
    except ValueError:
        return None
    else:
        tool_name = parts[2]
        return (server_id, tool_name)
