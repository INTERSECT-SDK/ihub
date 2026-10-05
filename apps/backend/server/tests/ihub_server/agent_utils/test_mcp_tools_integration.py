"""Unit tests for MCP tool ID parsing.

Live MCP integration should be covered by dedicated environment tests,
not the default local unit test suite.
"""

import pytest

from ihub_server.agent_utils.mcp_tools import (
    _build_model_tool_text,
    _serialize_mcp_result,
    parse_mcp_tool_id,
)


class FakeContentBlock:
    def __init__(self, payload):
        self.payload = payload
        self.text = payload.get("text")

    def model_dump(self, **_kwargs):
        return self.payload


def test_hardcoded_mcp_tool_creation():
    """Parses a valid hardcoded MCP tool reference."""
    parsed = parse_mcp_tool_id("mcp:13:say_hello")

    assert parsed == (13, "say_hello")


def test_invalid_mcp_tool_id_returns_none():
    """Returns None for invalid MCP tool reference formats."""
    assert parse_mcp_tool_id("say_hello") is None
    assert parse_mcp_tool_id("mcp:not-an-int:say_hello") is None


def test_mcp_result_preserves_typed_content_as_artifact():
    result = type(
        "ToolResult",
        (),
        {
            "content": [
                FakeContentBlock({"type": "text", "text": "Processed image"}),
                FakeContentBlock(
                    {
                        "type": "image",
                        "data": "iVBORw0KGgo=",
                        "mimeType": "image/png",
                    }
                ),
            ],
            "structured_content": {"n_atoms": 15},
            "is_error": False,
        },
    )()

    assert _build_model_tool_text(result) == "Processed image"
    assert _serialize_mcp_result(result) == {
        "content": [
            {"type": "text", "text": "Processed image"},
            {
                "type": "image",
                "data": "iVBORw0KGgo=",
                "mimeType": "image/png",
            },
        ],
        "structuredContent": {"n_atoms": 15},
        "isError": False,
    }


def test_mcp_tool_resolution_with_registry():
    """Integration behavior is skipped in unit test runs."""
    pytest.skip("Requires live MCP server and database setup")


# Workflow example (manual integration test)
# ===========================================
#
# To test this manually, you would:
#
# 1. Start the MCP server:
#    cd apps/backend/mcp_server
#    python -m uvicorn main:app --host 0.0.0.0 --port 8010
#
# 2. Create MCP server entry in database:
#    - POST /api/v1/mcp_servers with:
#      {
#        "label": "Local MCP Server",
#        "url": "http://localhost:8010",
#        "token": "optional-token"
#      }
#    - Note the returned ID (e.g., 13)
#
# 3. Create an agent with the hardcoded tool:
#    - Create via API or directly in code:
#      agent_def = Agent(
#          name="MyChatAgent",
#          graph_type="basic",
#          model_id=1,  # Your LLM model ID
#          tool_ids=["mcp:13:say_hello"],  # Hardcoded reference!
#          system_prompt="You are a helpful assistant.",
#      )
#
# 4. Build and use the agent:
#    factory = AgentFactory()
#    graph = factory.build(agent_def, "conv-123")
#
#    # Now when the agent runs, it can call the say_hello tool!
#    response = graph.invoke({"messages": [HumanMessage("Hello")]})


if __name__ == "__main__":
    print("Run with: pytest test_mcp_tools_integration.py -v")
