"""
MCP Server for iHub AI agents.
"""

import logging
import os

from fastmcp import FastMCP

from tool_registry import register_enabled_tools

# FastMCP server configurations
PORT = os.getenv('PORT', '8100')
TRANSPORT = 'streamable-http'
HOST = '0.0.0.0'  # noqa: S104

# Logging config
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

ENABLED_TOOLS = {
    'list_intersect_capabilities': True,
    'list_intersect_services': True,
    'hello_mcp': True,
    'random_number': True,
    'test_visualization': True,
}


def create_mcp_server(enabled_tools: dict[str, bool] | None = None) -> FastMCP:
    mcp = FastMCP('ihub-mcp-server')
    register_enabled_tools(mcp, ENABLED_TOOLS if enabled_tools is None else enabled_tools)
    return mcp


mcp = create_mcp_server()

if __name__ == '__main__':
    mcp.run(host=HOST, transport=TRANSPORT, port=int(PORT))
