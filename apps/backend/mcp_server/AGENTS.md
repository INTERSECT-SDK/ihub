# MCP server guidance

This file supplements the repository root `AGENTS.md` for work under
`apps/backend/mcp_server/**`.

## Service map

- FastAPI/MCP application entrypoint: `main.py`.
- Tool registry: `tool_registry.py`.
- Tool implementations: `tools`.
- Existing test files: `tests`.

## Environment and commands

- Python requirement: `>=3.12`.
- The development and start scripts load `.env` through PDM.
- Install: `pnpm -C apps/backend/mcp_server install`.
- Develop: `pnpm -C apps/backend/mcp_server dev`.
- Start: `pnpm -C apps/backend/mcp_server start`.
- Test: `pnpm -C apps/backend/mcp_server test`.
- Check formatting without modifying files:
  `pnpm -C apps/backend/mcp_server format:check`.
- Format and modify files: `pnpm -C apps/backend/mcp_server format`.
- Check lint without modifying files:
  `pnpm -C apps/backend/mcp_server lint:check`.
- Lint and apply fixes: `pnpm -C apps/backend/mcp_server lint`.
- From `apps/backend/mcp_server`, run a focused test file with
  `pdm run pytest tests/<test_file>.py`. Append `::<test_name>` to select one
  test.
- `scripts/mcp_tool_tester.py` is an editable manual client, not an automated
  test. It is excluded from pytest discovery and requires a separately running,
  reachable MCP server.

## Python and service conventions

- Ruff enforces single quotes for inline strings and manages import ordering.
- The first-party package configured for import sorting is `db`.
- Mypy configuration exists, but the package lint command runs only
  `ruff check --fix`; it does not invoke mypy.
- Ruff rules cover import sorting, naming, complexity, and error handling. Do
  not add ignores for convenience.
- The lint and format commands can modify files. Review the worktree diff after
  running them; use the corresponding check commands for non-mutating
  verification.
- Keep registry and transport concerns separate from individual tool behavior.
- Preserve the established boundaries between the registry and tool modules.
