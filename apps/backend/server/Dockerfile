ARG REPO=
# common environment variables
FROM ${REPO}python:3.13-slim AS environment

# set to non-empty string to skip dev dependencies
ARG PRODUCTION=
ENV PDM_VERSION=2.26.2 \
    PDM_HOME=/usr/local \
    PDM_CHECK_UPDATE=false \
    PIP_NO_CACHE_DIR=off \
    PIP_DISABLE_PIP_VERSION_CHECK=on \
    PRODUCTION=${PRODUCTION:-}

# intermediate PDM build stage
FROM environment AS builder

WORKDIR /app
RUN apt update \
    && apt-get install --no-install-recommends -y \
    curl \
    && rm -rf /var/lib/apt/lists/*
RUN pip install -U pdm
# disable update check
ENV PDM_CHECK_UPDATE=false

# add minimal files needed for package install
# note that we are NOT installing the ihub_server as a package in this instance
COPY pyproject.toml README.md pdm.lock ./
RUN if [ -n "${PRODUCTION}" ]; then pdm sync --no-editable --prod; else pdm sync --no-editable --dev; fi

# testing stage - for running tests
FROM builder AS testing

WORKDIR /app
COPY ihub_server ihub_server
COPY migrations migrations
COPY tests tests
ENV PATH="/app/.venv/bin:$PATH"
CMD ["python", "-m", "pytest", "tests/"]

# main execution environment
FROM environment AS runtime

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY ihub_server ihub_server

# Currently needed for Agentic AI Demo
COPY configs configs

# this is strictly for supporting migrations at runtime
COPY migrations migrations
COPY alembic.ini alembic.ini

ENV PATH="/app/.venv/bin:$PATH"

# Override CMD at container runtime for tests. Campaign event listener ownership
# is process-local, so Settings constrains UVICORN_WORKERS to 1. Scale by running
# one backend process until cross-process listener coordination is implemented.
CMD ["sh", "-c", "fastapi run ihub_server/main.py --workers ${UVICORN_WORKERS:-1}"]
