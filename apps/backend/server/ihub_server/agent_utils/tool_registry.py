"""Registry for resolving tool IDs to callable tools for agents."""

from __future__ import annotations

import logging

from .mcp_tools import create_mcp_tool, get_mcp_tool_schema, parse_mcp_tool_id

_log = logging.getLogger("ihub-server")


class ToolRegistry:
    """Registry for storing and resolving tools used by agents.

    Supports:
    - Hardcoded registered tools (e.g., local tools)
    - MCP tool references in format "mcp:SERVER_ID:TOOL_NAME"
    """

    def __init__(self):
        """Initialize empty tool registry."""
        self._tools = {}

    def register(self, tool_id: str, tool: object) -> None:
        """Register a tool by ID.

        Args:
            tool_id: Unique identifier for the tool
            tool: Callable tool object (typically a LangChain StructuredTool)
        """
        self._tools[tool_id] = tool
        _log.info(f"Registered tool: {tool_id}")

    def get(self, tool_id: str) -> object:
        """Get a tool by ID.

        Supports two resolution paths:
        1. Direct lookup if tool is registered
        2. Dynamic MCP tool creation if ID matches "mcp:SERVER_ID:TOOL_NAME" format

        Args:
            tool_id: Tool identifier

        Returns:
            Resolved tool object

        Raises:
            KeyError: If tool not found and not a valid MCP reference
            ValueError: If MCP server not found or invalid reference
        """
        # Try direct lookup first
        if tool_id in self._tools:
            return self._tools[tool_id]

        # Try parsing as MCP tool reference
        mcp_ref = parse_mcp_tool_id(tool_id)
        if mcp_ref:
            server_id, tool_name = mcp_ref
            _log.debug(f"Resolving MCP tool: {tool_name} on server {server_id}")
            tool_schema = None
            try:
                tool_schema = get_mcp_tool_schema(server_id, tool_name)
            except (RuntimeError, TimeoutError, ValueError) as exc:
                _log.warning(
                    "Could not fetch schema for MCP tool %s on server %s: %s. "
                    "Proceeding without schema.",
                    tool_name,
                    server_id,
                    exc,
                )

            # Dynamically create and cache the tool
            tool = create_mcp_tool(
                mcp_server_id=server_id,
                tool_name=tool_name,
                tool_description=f"MCP tool '{tool_name}' from server {server_id}",
                tool_schema=tool_schema,
            )
            # Cache for future use
            self._tools[tool_id] = tool
            return tool

        # Not found as registered tool or MCP reference
        msg = f"Tool '{tool_id}' not found and not a valid MCP reference"
        raise KeyError(msg)

    def resolve_many(self, tool_ids: list[str]) -> list[object]:
        """Resolve multiple tool IDs to tool objects.

        Args:
            tool_ids: List of tool identifiers

        Returns:
            List of resolved tool objects in the same order as input

        Raises:
            KeyError: If any tool cannot be resolved
        """
        return [self.get(tid) for tid in tool_ids]
