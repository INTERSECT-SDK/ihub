# iHub User Interface

This repository is the marketplace and campaign builder UI for iHub.

## Noteable Libraries Used

- [Next.js](https://nextjs.org/)
- [Mantine UI Components](https://mantine.dev/)
- [React Flow](https://reactflow.dev/)
- [React Joyride](https://v3.react-joyride.com/)

## Getting Started

You first need to install [pnpm](https://pnpm.io/).

```
pnpm install  # if libraries are not installed
pnpm run dev  # start development server
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result. Only the UI will be served.
If you need all apps within ihub-services running (e.g. server, jupyter), go to the root of the project and run `pnpm run dev`

## Hub Browser Tests

The Launcher tour and Project Files Playwright suites use in-memory API
fixtures, but they serve the Hub through the local Nginx proxy at
[http://127.0.0.1:8080/hub](http://127.0.0.1:8080/hub). Start the lightweight
development services from the repository root:

```
docker compose -f docker-compose.dev.yml up -d
```

Install the Chromium browser once if it is not already available, then run a
suite:

```
pnpm -C apps/frontend/hub exec playwright install chromium
pnpm -C apps/frontend/hub test:launcher-tour:e2e
pnpm -C apps/frontend/hub test:project-files:e2e
```

Each Playwright configuration starts or reuses the Hub development server on
port 3000. Reports, traces, and screenshots are written under
`apps/frontend/hub/output/playwright/`.

## Add a New Package

Be sure you are **in this folder** before installing a new library. You install a new package by:

```
pnpm add <package>    # save to `dependencies`
pnpm add -D <package>  # save to `devDependencies`
```
