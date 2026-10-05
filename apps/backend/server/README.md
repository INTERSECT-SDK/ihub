# iHub Backend

This repository defines a FastAPI server that handles all the API calls, data management, and modeling needs for iHub services.

## Requirements

- [PDM](https://pdm-project.org/en/latest/): python packaging and dependency management made easy

## Development

### Set up backing services

The application requires a PostgreSQL database and other services to be running. Configurations for both are provided in the repository root's `docker-compose.dev.yml` .

To start the services, run `docker compose -f docker-compose.dev.yml up -d`.

### Install Packages

To install packages for `backend/server`:

```
pdm install    # run command in this folder
```

_Note_: to install packages for all application in ihub-services use `pnpm run install`

### Adding Packages

To add a python package to `backend/server`:

```
pdm add <package>    # run command in this folder
```

This will update the `pyproject.toml` and `pdm.lock` file.

### Setup Environment

Copy `.env.example` into `.env` and make changes as necessary. The default
values are designed to work with the local docker-compose setup. Obtain
deployment secrets through an approved secret-management channel; never email
or commit an environment file. For setup support, contact
[ihub-support@ornl.gov](mailto:ihub-support@ornl.gov).

### Local Development

To run the server as a part of the stack (e.g. including UI):

```
pnpm run dev    # run command at the repo root
```

or

To run the server as a standalone service (e.g. for API development or testing):

```
pnpm run dev --filter=server    # run command at the repo root
```

Go to `localhost:8000` to see the API documentation

Go to `localhost:8000/docs` to experiment with the endpoints

NOTE: With the nginx container is running, the API test endpoints are also available through `localhost:8080/docs`.

### Module Layout

- `ihub_server/api/v1/endpoints`: FastAPI routers and request/response mapping
- `ihub_server/services`: business logic and orchestration
- `ihub_server/repositories`: persistence boundary for SQLModel access
- `ihub_server/core`: external system adapters and startup utilities
- `ihub_server/api/deps.py`: dependency wiring for services

### Running Tests

To run tests locally with PDM:

```
pdm run test
```

(or)

```
pdm run pytest tests/
```

To run tests with coverage reporting (including per-service coverage validation):

```
pdm run test-coverage
```

The `test-coverage` script generates `coverage.json` and enforces 90% coverage for each module in `ihub_server/services/`.

To run tests from the repo root:

```
pnpm -C apps/backend/server test
```

To run tests in a Docker container:

```bash
docker build --target testing -t ihub-server-testing:latest .
docker run --rm \
  --mount type=bind,source="$PWD/../../../pnpm-workspace.yaml",target=/app/pnpm-workspace.yaml,readonly \
  --mount type=bind,source="$PWD/../../../contracts",target=/app/contracts,readonly \
  ihub-server-testing:latest
```

#### Test Organization

- Place tests under `tests/`.
- Shared fixtures live in `tests/conftest.py` (e.g., the FastAPI `TestClient` and common test data).
- Add new API tests alongside `tests/test_healthcheck.py` or under `tests/ihub_server/` as the suite grows.

The Docker testing image includes all dev dependencies and runs pytest by
default. The read-only mounts provide the shared repository-level contract
fixtures used by the backend contract tests.

### Running migrations

(note: if not running commands in this directory, you should also include `-c <path/to/alembic.ini>` in your command)

It's useful to read [the official Alembic documentation](https://alembic.sqlalchemy.org/en/latest/tutorial.html), but this section will attempt to give a condensed summary.

Whenever you change a file in `ihub_server/models` which is meant to be representative of a table class (i.e. extends `SQLModel` and has the metaclass attribute `table=True`), you must do the following:

1. import the file in `migrations/env.py` (or just export it in `models/__init__.py` and let the `*` import take care of it)
2. run `alembic revision --autogenerate -m "<YOUR_MESSAGE_HERE>"`

From there, you can do one of two things:

- restart the server, because it will attempt to run the migrations on startup
- run `alembic upgrade head` on the command line

Downgrades should always be manual. In production, you should generally run commands like `alembic downgrade -1` (the `-1` signifies that you should downgrade one migration version), OR you can manually scan the migration version files for the `revision` field and run `alembic downgrade <revision>` . NOTE: if you downgrade a revision, it appears that you can NEVER reapply it to the same database...

To generate SQL output (instead of directly applying changes to a database), add the `--sql` flag to any alembic command. It is possible that for production deployments we may not be able to directly modify the DB, in which case submitting the SQL output to a DBA to execute is the correct approach. With this usecase, `ALEMBIC_RUN_MIGRATIONS` should be set to `False` in the configuration.

## Production Deployment

See the production deployment instructions in the root README [here](https://code.ornl.gov/intersect/ihub/ihub-services#production-deployment).

The backend supports `UVICORN_WORKERS`, but its only valid value is `1`.
Campaign event listeners and browser fan-out are owned in process, so multiple
backend workers would create duplicate upstream listeners. Deploy one backend
worker until listener ownership is coordinated across processes.
