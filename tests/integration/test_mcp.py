"""ihub-mcp behind Nginx, calling back into ihub-server over IHUB_SERVER_*."""

import json

from browser import Browser, Response

MCP_URL = "/ihub_mcp/mcp"
MCP_HEADERS = {"Accept": "application/json, text/event-stream"}


def rpc_result(response: Response) -> dict[str, object]:
    """Return the JSON-RPC result from a JSON or server-sent-events response."""
    assert response.status == 200, f"MCP request failed with {response.status}: {response.text}"
    body = response.text
    if "text/event-stream" in response.headers.get("Content-Type", ""):
        body = next(line[5:] for line in body.splitlines() if line.startswith("data:"))
    message = json.loads(body)
    assert "error" not in message, message
    return message["result"]


def mcp_session(browser: Browser) -> dict[str, str]:
    """Initialize an MCP session and return the headers that carry it."""
    response = browser.post_json(
        MCP_URL,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "ihub-integration-tests", "version": "0"},
            },
        },
        headers=MCP_HEADERS,
    )
    rpc_result(response)
    headers = {**MCP_HEADERS, "Mcp-Session-Id": response.headers["Mcp-Session-Id"]}
    browser.post_json(
        MCP_URL, {"jsonrpc": "2.0", "method": "notifications/initialized"}, headers=headers
    )
    return headers


def test_mcp_lists_intersect_tools(browser: Browser) -> None:
    headers = mcp_session(browser)

    result = rpc_result(
        browser.post_json(
            MCP_URL, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, headers=headers
        )
    )

    tool_names = {tool["name"] for tool in result["tools"]}
    assert {"list_intersect_services", "list_intersect_capabilities"} <= tool_names


def test_mcp_tool_reads_services_from_server(browser: Browser) -> None:
    headers = mcp_session(browser)

    result = rpc_result(
        browser.post_json(
            MCP_URL,
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "list_intersect_services", "arguments": {}},
            },
            headers=headers,
        )
    )

    assert result["isError"] is False, result
