FROM node:24-slim AS base

# ARG Variables (available at build time)
ARG APP_NAME="hub"
ARG NEXT_PUBLIC_VERSION

# ENV Variables
ENV PORT=${PORT}
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PNPM_HOME:$PATH"

# Upgrade to latest Corepack
RUN npm install -g corepack@latest
RUN corepack enable

# Builder stage to install turbo and copy app files
FROM base AS builder
WORKDIR /app
COPY . .

# Generate a partial monorepo with a pruned lockfile for a target workspace.
RUN pnpm dlx turbo prune ${APP_NAME} --docker

# Installer stage to build app
FROM base AS installer
WORKDIR /app

# Must be available at build time
ENV NEXT_PUBLIC_VERSION=${NEXT_PUBLIC_VERSION}

COPY --from=builder /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=builder /app/out/full/ .
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm dlx turbo run build --filter=${APP_NAME}... --concurrency=1


# Runner stage to only contain build output to minimize image size
FROM base AS runner
WORKDIR /app


# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 ${APP_NAME}
USER ${APP_NAME}

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=installer --chown=${APP_NAME}:nodejs /app/apps/frontend/${APP_NAME}/.next/standalone ./
COPY --from=installer --chown=${APP_NAME}:nodejs /app/apps/frontend/${APP_NAME}/.next/static ./apps/frontend/${APP_NAME}/.next/static
COPY --from=installer --chown=${APP_NAME}:nodejs /app/apps/frontend/${APP_NAME}/public ./apps/frontend/${APP_NAME}/public

CMD node apps/frontend/hub/server.js
