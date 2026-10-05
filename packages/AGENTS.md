# Shared package guidance

This file supplements the repository root `AGENTS.md` for work under
`packages/**`.

## Package map

- `ui/src`: shared React components for campaign graphs, chat, header and
  navigation, notebooks, visualization, and project navigation.
- `ui/src/ihub_campaign`: campaign modules grouped by domain under `editor`,
  `execution`, `graph`, and `state`.
- `ui/src/ihub_campaign/nodes`: node modules grouped by responsibility under
  `capability`, `code`, `common`, `event`, `json-file`, `json-text`, `renderer`,
  `upstream`, and `visualization`.
- `utils/src`: shared helpers, hooks, icons, and TypeScript types.
- `eslint-config`: shared ESLint flat configurations.
- `typescript-config`: shared TypeScript configurations.

## UI commands

- Lint: `pnpm -C packages/ui lint`.
- Format: `pnpm -C packages/ui format`.
- Typecheck: `pnpm -C packages/ui check-types`.
- Run chat tests: `pnpm -C packages/ui test:chat`.
- Run campaign tests: `pnpm -C packages/ui test:campaign`.
- Run notebook tests: `pnpm -C packages/ui test:notebook`.

## Utils commands

- Lint: `pnpm -C packages/utils lint`.
- Format: `pnpm -C packages/utils format`.
- Typecheck: `pnpm -C packages/utils check-types`.

## Package conventions

- Use workspace packages through `@ihub/*` exports when available.
- Keep exported shared APIs narrow and explicit because changes can affect
  multiple applications.
- Place reusable components in `packages/ui` only after a shared use case is
  established.
- UI and Utils use shared ESLint configurations. Treat warnings as actionable
  even though `only-warn` prevents them from failing the command.
- The UI and Utils lint scripts run `eslint --fix` and can modify files. Review
  the worktree diff after linting.
