# iHub Repository

This is the official repository for the iHub LDRD project. iHub is a platform to discover, share and interact with services and their capabilites within the INTERESECT ecosystem. The project's goals over the next two years are to develop and add two core services to INTESERCT: (1) a marketplace and (2) a campaign builder. We hope iHub to evolve beyond these two core services in the future.

This repository is setup as a monorepo using [Turborepo](https://turbo.build/). All services that are apart of iHub are contained in this repository.

## Required Software for Development

- [pnpm](https://pnpm.io/): a fast, disk space efficient package manager (alternative to npm).
- [PDM](https://pdm-project.org/en/latest/): python packaging and dependency management made easy
- [docker](https://www.docker.com/): containerization software.
- [docker compose](https://docs.docker.com/compose/): containerization software.

## Optional Software

- [Ollama](https://ollama.com/): run large language models locally.

## What's inside?

This repository includes the following:

### Main Services

- `apps/frontend/hub`: iHub UI built with [Next.js](https://nextjs.org/)
- `apps/backend/server`: iHub backend server for to serve necessary endpoints.
- `apps/backend/jupyter_hub`: JupyterHub configuration and runtime files.
- `apps/backend/nginx`: Reverse proxy for production deployment

### Shared

- `packages/ui`: shared react component folder.
- `packages/utils`: shared frontend helpers, hooks, icons, and types.
- `packages/eslint-config`: `eslint` configurations (includes `eslint-config-next` and `eslint-config-prettier`).
- `packages/typescript-config`: `tsconfig.json`s used throughout the monorepo.

### Utilities

This Turborepo has some additional tools already setup for you:

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Prettier](https://prettier.io) for code formatting

## Local Developement

### Environment Files

Copy `apps/backend/server/.env.example` to `apps/backend/server/.env` and
configure it for your environment. Obtain deployment secrets through an
approved secret-management channel; never email or commit an environment file.
For setup support, contact [ihub-support@ornl.gov](mailto:ihub-support@ornl.gov).

Project file uploads are limited to 10 MiB by default. To change the limit, set
`PROJECT_FILE_UPLOAD_MAX_BYTES` to a positive integer representing the maximum
raw file size in bytes. Nginx derives a JSON/base64 request-envelope limit from
that value for backend project-file uploads under `/api`: four times the
ceiling of the raw byte count divided by three, plus 46 bytes for the request
JSON and 1 KiB of headroom. Direct Jupyter editor saves under `/ijupyterhub/`
receive a separate worst-case allowance of twice the raw byte count, plus the
same 46 bytes and 1 KiB, so quote- or backslash-heavy text remains within the
limit after JSON escaping. The production and full-development Compose stacks
pass the root `.env` value to both the backend and Nginx automatically. With
the lightweight `docker-compose.dev.yml` stack, set the same value in the root
`.env` for Nginx and in `apps/backend/server/.env` for the host-run backend,
then restart both services. Rebuild and recreate Nginx after changing the value
or its configuration template.

### Package Install

Install packages for the frontend and backend:

```
cd ihub-services
pnpm install
```

Note: backend server packages are installed using _pdm_.

### LLM Development with Ollama

If wanting to use the the LLM application on the dashboard, you will need to install [Ollama](https://ollama.com/).
The app currently uses the **llama3.2 (3b)** model. Download the model first by running:

`ollama pull llama3.2`

Ollama runs in the background on **port: 11434**.

### Local Development

Bring up the development services first (e.g. databast, nginx-dev, etc...):

```
docker compose -f docker-compose.dev.yml up --build -d
```

Inspect the development proxy with its Compose service name:

```
docker compose -f docker-compose.dev.yml logs nginx-dev
```

Start up the development environment:

```
pnpm run dev
```

Go to:

- [http://localhost:8080](http://localhost:8080) - UI
  - Use the synthetic credentials configured by the local development fixture.
- [http://localhost:8080/docs](http://localhost:8080/docs) - backend endpoints
- [http://localhost:3003](http://localhost:3003) - Docsify docs (via `pnpm run docs`)

#### Chrome HTTP requirement

Both local Compose variants use HTTP and WebSockets without local TLS. Always
open the Hub with the explicit URL
[http://localhost:8080](http://localhost:8080); do not replace `http://` with
`https://`.

If Chrome's **Always use secure connections** setting is enabled, open
**Settings > Privacy and security > Security > Secure connections** and select
**Warns you for insecure public sites** so Chrome permits private sites such as
the local development stack to use HTTP. See
[Chrome's security settings guidance](https://support.google.com/chrome/answer/10468685?co=GENIE.Platform%3DDesktop)
for details.

To run applications separately:

```
pnpm run dev --filter=hub          # only bring up the Hub UI
pnpm run dev --filter=server       # only bring up the backend server
docker compose -f docker-compose.dev.yml up --build -d ihub-jupyterhub
```

JupyterHub is managed by Docker Compose rather than as a Turbo workspace
package. The focused Compose command also starts its required volume
initialization service.

### Full Containerized Local Development (dev-full)

Use this setup when you want everything running in containers, including the server, UI, campaign orchestrator, broker, and random number service.

Start from a clean state:

```
docker compose -f docker-compose.dev-full.yml down -v
docker compose -f docker-compose.dev-full.yml up -d --build
```

Inspect the full-development proxy with:

```
docker compose -f docker-compose.dev-full.yml logs nginx-dev
```

Go to:

- [http://localhost:8080](http://localhost:8080) - UI
  - Login via OIDC (happens automatically via KeyCloak as "Dev User")
- [http://localhost:8080/docs](http://localhost:8080/docs) - backend endpoints

Expected behavior after startup:

- A broker entry is auto-created and connected (label defaults to `Dev INTERSECT Broker`).
- The `random-service` service appears after lifecycle registration (may take up to 30 seconds or more...)
- The `Random_Number_Generator` capability appears once the service is registered 
- The Campaign Orchestrator is auto-registered for iHub to submit campaigns
- Can use iHub to "Launch iHub" -> OIDC Login -> Create Project -> Create Campaign -> Launch Campaign


Stop the full stack:

```
docker compose -f docker-compose.dev-full.yml down
```

### Starting Mock INTERSECT Capabilities

Mock capabilities repository can be found here: https://code.ornl.gov/intersect/ihub/mock-capabilities.

The mock capabilities have their own broker running on **port 5673**. The broker must be added before being connected to and listening to messages.
Once the broker is up, add the broker by:

1. Go to broker menu in iHub
2. _Click Add_ broker connection
3. Enter information:
   - **Name**: Mock Capabilities (or anything else)
   - **IP Address**: localhost
   - **Port**: 5673
   - **Message Protocol**: amqp0.9.1
   - **Username**: the mock fixture's `BROKER_USERNAME` value
   - **Password**: the mock fixture's `BROKER_PASSWORD` value
4. _Click Add_
5. _Click Connect_

### Production Deployment

iHub uses _Docker_ to containerize frontend/backend services and _Docker Compose_ to coordinate containers:

Before starting the production stack, set `NGINX_SERVER_NAME`,
`TLS_CERT_FILE`, and `TLS_KEY_FILE` in the root `.env`. The TLS file variables
must be absolute host paths. Compose mounts both files read-only; keep the
private key itself outside the repository and obtain it through an approved
secret-management channel.

```
pnpm run deploy:build   # builds the docker images
pnpm run deploy:up      # run docker containers with docker compose
```

When upgrading a deployment that previously allowed Guest mode, run the
following command once after the backend and JupyterHub are available:

```
docker exec ihub-server python -m ihub_server.tools.retire_guest_jupyter_access
```

This revokes legacy guest Jupyter tokens and stops the guest's running server
without deleting guest files. The command is safe to run again if the guest
account or server is already absent.

A nginx container is also deployed as service. Once containers are running, go to [http://localhost](http://localhost).

The production stack includes an Ollama container and exposes it to the Hub
through `/ihub_ollama/`. The container reserves all available NVIDIA GPUs and
stores downloaded models in the persistent `ihub_ollama_vol` volume. Models are
not downloaded automatically. After starting the stack, install the default
Hub model with:

```
docker exec ihub-ollama ollama pull llama3.2
```

Production docs endpoints:
- [http://localhost:3002](http://localhost:3002) - docs service direct port
- [http://localhost/ihub_docs/](http://localhost/ihub_docs/) - docs service via nginx proxy

To **stop** or **destory** containers:

```
pnpm run deploy:stop    # stop containers
pnpm run deploy:down    # stop and destroy containers
```

## Contribution Guidelines

Use the following guidelines when contributing to the code base.

### Development Workflow

1. **Create issue** - select which _epic_ and _milestone_ it belongs to. Also include the ihub _labels_.
2. **Create Merge Request and Branch** - use this option when creating a new merge request. It will auto create a new branch at the same time. The commits are displayed as they are pushed to the remote branch.
3. **Review** - small changes or documentation don't require review; otherwise,
   request review from the repository's current maintainers. **Write steps** in
   the comments explaining how the feature should be tested.
4. **Merge** - **select to delete feature branch and squash commits**.
5. **Version** - update the version in `.env`.
6. **Tag** - add a tag with the correct version to `main` after merging.
7. **Notify** - message the iHub group in Teams that main has been updated and provide a link to the new tag.

### Tagging

Tag the `main` branch after merging a merge request. Use the following tagging guide:

- major.minor.patch/bug (e.g. `v1.1.2`)
  - **major** - breaking changes. Version `v1.0.0` is the goal by end of FY25.
  - **minor** - new feature, apis, database model, etc...
  - **patch** - bug fixes, code formatting, optimizations and document updates.

### Other Guidelines

- Do **not** push directly to `main` branch unless you are just making documentation (e.g. README.md) updates. Please follow **Development Workflow** guideliens to push changes to the code base.
