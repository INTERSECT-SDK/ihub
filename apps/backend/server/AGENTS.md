# Backend server guidance

This file supplements the repository root `AGENTS.md` for work under
`apps/backend/server/**`.

## Service map

- Application entrypoint: `ihub_server/main.py`.
- API routes: `ihub_server/api/v1/endpoints`.
- Configuration and dependencies: `ihub_server/core` and
  `ihub_server/api/deps.py`.
- Domain code: `ihub_server/models`, `repositories`, `services`, `tools`, and
  `utils`.
- Agent and orchestration helpers: `ihub_server/agent_utils` and
  `ihub_server/intersect_control_plane_fork`.
- Pytest coverage: `tests`.
- Alembic migrations: `migrations`.

## Environment and commands

- Python requirement: `>=3.12,<3.14`.
- The service requires `apps/backend/server/.env`.
- Install: `pnpm -C apps/backend/server install`.
- Develop: `pnpm -C apps/backend/server dev`.
- Start: `pnpm -C apps/backend/server start`.
- Format: `pnpm -C apps/backend/server format`.
- Lint: `pnpm -C apps/backend/server lint`.
- Test: `pnpm -C apps/backend/server test`.
- Coverage: `pnpm -C apps/backend/server test:coverage`.

From `apps/backend/server`, run a single test with
`pdm run pytest tests/test_file.py::test_name`.

## Python and service conventions

- Ruff enforces double quotes and manages import ordering.
- The first-party package is `ihub_server`.
- Mypy is configured and the composite lint command runs both
  `ruff check --fix` and `mypy ihub_server/`.
- Ruff rules cover import sorting, naming, complexity, and error handling. Do
  not add ignores for convenience.
- The lint command applies Ruff fixes and can modify files. Review the worktree
  diff after running it.
- Keep API handlers thin and place domain behavior in services or focused
  helpers.
- Use repositories for persistence and preserve existing model, service,
  repository, utility, and dependency-injection boundaries.
- Keep migrations focused on persistence changes and update the narrowest
  reliable tests when API, service, or persistence contracts change.
