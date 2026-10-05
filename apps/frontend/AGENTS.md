# Frontend guidance

This file supplements the repository root `AGENTS.md` for work under
`apps/frontend/**`.

## Application map

- `hub`: Next.js UI on port 3000; source is under `src/app`, `src/components`,
  `src/hooks`, `src/atoms`, and `src/constants`.
- `marketplace`: Next.js UI on port 3001; source is under `src/app` and
  `src/components`.
- `docs`: docsify site on port 3002; Markdown content is at the package root and
  navigation is defined in `_sidebar.md`.

## Hub commands

- Develop: `pnpm -C apps/frontend/hub dev`.
- Build: `pnpm -C apps/frontend/hub build`.
- Start: `pnpm -C apps/frontend/hub start`.
- Lint: `pnpm -C apps/frontend/hub lint`.
- Format: `pnpm -C apps/frontend/hub format`.
- Run focused unit tests: `pnpm -C apps/frontend/hub test:unit`.
- Run the Launcher tour browser tests:
  `pnpm -C apps/frontend/hub test:launcher-tour:e2e`.
- Run the Project Files browser tests:
  `pnpm -C apps/frontend/hub test:project-files:e2e`.

The Hub browser suites use Chromium and target the Hub through local Nginx at
`http://127.0.0.1:8080/hub`. Keep Nginx on port 8080 and let each test
configuration start or reuse the Hub development server on port 3000.

## Marketplace commands

- Develop: `pnpm -C apps/frontend/marketplace dev`.
- Build: `pnpm -C apps/frontend/marketplace build`.
- Start: `pnpm -C apps/frontend/marketplace start`.
- Lint: `pnpm -C apps/frontend/marketplace lint`.
- Format: `pnpm -C apps/frontend/marketplace format`.

## Documentation commands

- Develop: `pnpm -C apps/frontend/docs dev` (port 3002).
- Start: `pnpm -C apps/frontend/docs start` (port 3002).
- The repository root `pnpm run docs` command serves the same content on port
  3003.

## Frontend conventions

- Hub uses the shared ESLint flat configuration from `@repo/eslint-config`.
- Marketplace imports `eslint-config-next/core-web-vitals` and
  `eslint-config-next/typescript` directly.
- React hooks and Next.js core web vitals rules are enabled.
- Keep application-specific data fetching and orchestration in the application
  when it is not reusable.
- Move UI into `packages/ui` when it is genuinely reusable across applications.
- Keep application components focused and follow the nearest `src` directory's
  established organization.
