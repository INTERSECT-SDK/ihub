# MCP Server

This folder contains the iHub MCP server. It exposes FastMCP tools over HTTP so MCP clients can discover and call backend capabilities.

## Key Files

- `main.py`: creates the `FastMCP` app, defines the enabled-tool map, and starts the server.
- `tool_registry.py`: central registry that maps tool names to Python callables and registers enabled tools with FastMCP.
- `tools/`: tool implementations grouped by domain.
- `tests/`: automated pytest coverage for the registry, server setup, and tools.
- `scripts/mcp_tool_tester.py`: editable manual client for calling a separately running MCP server.
- `configs/`: service-specific configuration files.

## Tool Layout

Current tool modules are organized under `tools/`:

- `basic_tools.py`: simple example/test tools.
- `intersect_tools.py`: tools that call the main iHub backend or INTERSECT-related services.

## Running Locally

From this directory:

Create a `.env` file in this directory with:

```env
IHUB_SERVER_HOST=127.0.0.1
IHUB_SERVER_PORT=8080 # with nginx_dev container running
```

```bash
pnpm install
pnpm dev
```

Useful commands:

```bash
pnpm install
pnpm dev
pnpm start
pnpm test
pnpm format:check
pnpm lint:check
pnpm format
pnpm lint
```

`pyproject.toml` defines the PDM-backed scripts used by these commands. `dev` and `start` both run `python main.py`. The `format:check` and `lint:check` commands do not modify files; `format` and `lint` can modify files.

To run one test file, or one test within that file, from this directory:

```bash
pdm run pytest tests/<test_file>.py
pdm run pytest tests/<test_file>.py::<test_name>
```

## How Tool Registration Works

`main.py` calls `create_mcp_server()`, which creates a `FastMCP('ihub-mcp-server')` instance and passes it to `register_enabled_tools(...)`.

`tool_registry.py` is the registration boundary:

1. Import the tool function.
2. Add a `ToolRegistryEntry` to `TOOL_REGISTRY`.
3. `register_enabled_tools(...)` loops through the registry and decorates each enabled callable with `registrar.tool()`.

`main.py` controls which registered tools are enabled at runtime through the `ENABLED_TOOLS` dictionary.

## Registering A New MCP Tool

To add a new tool:

1. Create the tool function in an appropriate file under `tools/`.
2. Give it a stable Python function name that should also be the MCP tool name.
3. Use type hints and `pydantic.Field(...)` metadata for arguments when the tool needs structured inputs.
4. Import the function in `tool_registry.py`.
5. Add a new `ToolRegistryEntry` in `TOOL_REGISTRY` with the same name as the function.
6. Add the tool name to `ENABLED_TOOLS` in `main.py` if you want it enabled by default.
7. Update or add tests in `tests/test_tool_registry.py`.

Example:

```python
# tools/example_tools.py
from typing import Annotated

from pydantic import Field


def describe_part(
    part_name: Annotated[str, Field(description='Name of the part to describe')],
) -> str:
    return f'Part: {part_name}'
```

```python
# tool_registry.py
from tools.example_tools import describe_part

TOOL_REGISTRY = {
    # ...
    'describe_part': ToolRegistryEntry(
        name='describe_part',
        func=describe_part,
    ),
}
```

```python
# main.py
ENABLED_TOOLS = {
    # ...
    'describe_part': True,
}
```

## Testing A Tool

- Registry behavior is covered in `tests/test_tool_registry.py`.
- Automated tests live under `tests/` and run with `pnpm test` or focused `pdm run pytest` commands.
- `scripts/mcp_tool_tester.py` is an editable manual client for calling a running tool over the MCP HTTP endpoint. Before running it, update its host, port, tool name, and arguments to match a separately running, reachable server. Its checked-in example invocation is not an unattended automated test.

When you add a tool, verify both:

- the tool appears in `TOOL_REGISTRY`, and
- it is enabled or disabled intentionally in `main.py`.
