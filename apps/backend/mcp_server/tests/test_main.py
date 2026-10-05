import unittest
from unittest.mock import patch

import main
from tool_registry import TOOL_REGISTRY


class CreateMcpServerTests(unittest.TestCase):
    def test_enabled_tools_include_service_discovery_by_default(self) -> None:
        assert main.ENABLED_TOOLS['list_intersect_services'] is True

    def test_enabled_tools_match_registry(self) -> None:
        assert set(main.ENABLED_TOOLS) == set(TOOL_REGISTRY)

    @patch('main.register_enabled_tools')
    @patch('main.FastMCP')
    def test_create_mcp_server_uses_default_enabled_tools(
        self,
        mock_fastmcp,
        mock_register_enabled_tools,
    ) -> None:
        mcp_instance = mock_fastmcp.return_value

        result = main.create_mcp_server()

        assert result is mcp_instance
        mock_fastmcp.assert_called_once_with('ihub-mcp-server')
        mock_register_enabled_tools.assert_called_once_with(mcp_instance, main.ENABLED_TOOLS)
