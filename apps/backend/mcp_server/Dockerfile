ARG REPO=
# common environment variables
FROM ${REPO}python:3.12-slim AS environment

# set to non-empty string to skip dev dependencies
ARG PRODUCTION=
ENV PDM_VERSION=2.29.7 \
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
RUN python -m pip install "pdm==${PDM_VERSION}"
# disable update check
ENV PDM_CHECK_UPDATE=false

# add minimal files needed for package install
COPY pyproject.toml pdm.lock ./
RUN if [ -n "${PRODUCTION}" ]; then \
    pdm install --check --frozen-lockfile --no-editable --prod; \
    else \
    pdm install --check --frozen-lockfile --no-editable --dev; \
    fi

# testing stage - for running checks and tests
FROM builder AS testing

WORKDIR /app
COPY . .
ENV PATH="/app/.venv/bin:$PATH"

# main execution environment
FROM environment AS runtime

WORKDIR /app

COPY . .
# replace the .venv folder
COPY --from=builder /app/.venv /app/.venv

ENV PATH="/app/.venv/bin:$PATH"
# main.py reads PORT from the environment; an empty value would crash startup.
ENV PORT=8100
EXPOSE 8100

# override CMD at container runtime for tests
CMD ["python", "main.py"]
