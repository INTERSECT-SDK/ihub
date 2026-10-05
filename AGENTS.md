# Guidance for agentic coding in this repository

## Scope

- Repository root: the checked-out repository directory.
- The monorepo uses Turborepo and pnpm; backend Python applications use PDM.
- No Cursor or Copilot rules were found in `.cursor/rules/`, `.cursorrules`,
  or `.github/copilot-instructions.md`.

## Repository map

- `apps/frontend`: Next.js applications and the docsify documentation site.
- `apps/backend`: FastAPI services, JupyterHub, and production/development
  Nginx configurations.
- `packages`: shared UI, utilities, ESLint, and TypeScript configuration
  packages.
- `apps/backend/jupyter_server` is a locally generated artifact directory, not
  a source package.

Ignore generated and cache directories when searching unless they are needed:
`.next`, `.turbo`, `node_modules`, `.venv`, `.ruff_cache`, `.mypy_cache`,
`.pytest_cache`, `.pdm-build`, `__pycache__`, `apps/backend/jupyter_server`,
root/local agent workspaces such as `.ant-colony`, `.pi`, and
`.opencode/node_modules`, and test home data in `ihub_home_dir_test`.

## Scoped guidance

Before changing a scoped subtree, read the nearest applicable instruction file
even when the task starts at the repository root:

- `apps/frontend/**`: read `apps/frontend/AGENTS.md`.
- `packages/**`: read `packages/AGENTS.md`.
- `apps/backend/server/**`: read `apps/backend/server/AGENTS.md`.
- `apps/backend/mcp_server/**`: read `apps/backend/mcp_server/AGENTS.md`.

Nginx, JupyterHub, and repository-level work use this root guidance; they do
not currently have additional scoped instructions. Nested guidance
supplements this file and should not duplicate shared rules from it.

## Environment and setup

- Install JavaScript dependencies from the repository root with `pnpm install`.
- The root package manager is `pnpm@11.18.0`; the Node engine is `>=18`.
- Python dependencies and runtime requirements are owned by each backend
  application and documented in its scoped guidance.

## Root commands

- Build everything: `pnpm run build` (Turbo).
- Develop everything: `pnpm run dev` (Turbo).
- Lint everything: `pnpm run lint` (Turbo).
- Format everything: `pnpm run format` (Turbo).
- Serve `apps/frontend/docs` on port 3003: `pnpm run docs`.
- Build production containers: `pnpm run deploy:build`.
- Start production containers: `pnpm run deploy:up`.
- Stop production containers: `pnpm run deploy:stop`.
- Stop and remove production containers: `pnpm run deploy:down`.

Use Turbo filters for a single package:

- Develop: `pnpm run dev --filter=<package>`.
- Lint: `pnpm run lint --filter=<package>`.
- Format: `pnpm run format --filter=<package>`.
- Build: `pnpm run build --filter=<package>`.

## Tests

- Prefer behavior-focused tests over tests that mirror implementation details.
- Add regression coverage for bug fixes and edge cases for new branching logic.
- Keep tests close to the package being changed and reuse existing fixtures,
  factories, and test helpers before adding new ones.
- When a change crosses API, service, or persistence boundaries, cover the
  contract at the narrowest reliable level.
- Use the focused commands documented in the applicable scoped guidance.

## Shared code principles

- Prefer repository tooling over custom formatting and match patterns in the
  package being changed.
- Do not add lint rules or formatting configuration without team buy-in.
- Write idiomatic code for the language, framework, and package; prefer
  established framework patterns over generic abstractions.
- Optimize for readability and maintainability. Keep the normal path easy to
  follow, use descriptive names, and keep functions and components focused.
- Design for likely domain growth, but avoid speculative abstractions that do
  not simplify current behavior.
- Apply SOLID principles pragmatically:
  - keep modules, classes, functions, and components focused on one clear
    responsibility;
  - extend behavior through small, well-named interfaces or composition when
    cleaner than modifying unrelated code;
  - keep shared contracts stable and avoid surprising implementations or
    component variants;
  - prefer narrow interfaces and props over catch-all objects;
  - depend on abstractions at boundaries while keeping simple internal code
    direct.
- Keep business and domain logic separate from transport, rendering, and
  persistence layers when the surrounding package has those boundaries.
- Reduce duplication when it clarifies intent, but do not hide simple code
  behind helpers that make call sites harder to understand.
- Make invalid states hard to represent through types, validation, or explicit
  runtime checks.
- Preserve public APIs unless the requested change requires a breaking update;
  document intentional behavior changes.
- Add or update tests for meaningful behavior changes, bug fixes, and shared
  contracts.

## TypeScript and JavaScript

- Use Prettier with no semicolons, single quotes in JavaScript/TypeScript and
  JSX, trailing commas where valid, an 80-column print width, and 2-space tabs.
- Do not disable lint rules locally without strong justification.
- Treat warnings from shared ESLint configurations as actionable even where
  `only-warn` prevents them from failing the command.
- Prefer explicit types for public interfaces and exported APIs.
- Add helpful TypeDoc comments for exported components, hooks, utilities, and
  complex functions when the signature does not explain intent, side effects,
  constraints, or non-obvious return values.
- Use `unknown` instead of `any` when a type is not yet known, narrow types
  early, and avoid `as` casting unless needed.
- Keep types close to the code they describe.
- Prefer discriminated unions or precise enums over loose strings and objects.
- Avoid broad optional-property bags when explicit types better model valid
  states.
- Derive types from schemas, constants, or existing APIs when that prevents
  duplicated contracts from drifting.
- Let ESLint and Prettier handle import ordering when possible. If editing
  manually, group imports by node, external, workspace, and local origin.

## React

- Prefer function components with hooks and avoid side effects during render.
- Use `useEffect` for side effects.
- Keep components small and focused.
- Separate data fetching and orchestration from presentational UI when it
  improves readability or reuse.
- Prefer narrow, explicit props instead of passing large objects through the
  component tree.
- Extract reusable components after a pattern is established, not before a
  second use case is clear.
- Keep derived render state close to its use and do not duplicate state that can
  be computed from props, URL state, or server data.

## Python

- Use Ruff for formatting, linting, and import sorting.
- Prefer typed function signatures and explicit return values for public
  functions, service methods, and non-trivial helpers.
- Follow PEP 8 naming: `snake_case` for functions and variables and
  `PascalCase` for classes. Favor descriptive names over abbreviations.
- Keep FastAPI route handlers thin: translate HTTP concerns in the route and put
  domain behavior in services or focused helpers.
- Respect existing service, repository, model, and utility boundaries. Do not
  reach around repositories for persistence or put database concerns in API
  handlers unless the surrounding code already does so.
- Use dependency injection at application boundaries when it improves
  testability or isolates external services; keep simple internal dependencies
  direct.

## Error handling

- Prefer explicit errors over silent failures.
- In Python, avoid bare `except:` and catch specific exceptions.
- Use FastAPI/HTTP exceptions at API boundaries where appropriate.
- In TypeScript and JavaScript, use typed error handling and guard unknown
  errors.
- Preserve original context when re-raising or translating errors.
- Log enough context to diagnose failures without exposing secrets, tokens, or
  sensitive user data.
- Return user-safe errors at API boundaries and keep implementation details in
  logs or internal exception chains.
- Do not swallow errors to keep a workflow moving unless the fallback is
  intentional, tested, and visible to callers.

## Formatting, linting, and documentation

- Do not hand-format generated files.
- Keep files ASCII unless the file already uses Unicode.
- Update related tests and types when changing API behavior.
- Lint commands are not uniformly read-only. Review the worktree diff after
  linting; scoped guidance identifies commands that apply fixes.
- Keep README sections current when development commands change.
- Add usage notes near public APIs when behavior is non-obvious.
- Document non-obvious configuration, environment variables, and integration
  assumptions near the code or README that owns them.
- Capture architectural decisions in existing documentation when a change
  introduces a boundary, external dependency, or cross-package contract.

## When in doubt

- Follow conventions in the nearest package.
- Match existing file organization and naming.
- Prefer small, incremental changes over refactors.
