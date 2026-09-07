ARG NODE_IMAGE=node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN npm install --global pnpm@11.7.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/console/package.json apps/console/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM ${NODE_IMAGE}
WORKDIR /app
ARG SDAR_SOURCE_REVISION=unknown
LABEL org.opencontainers.image.revision=${SDAR_SOURCE_REVISION}
COPY --from=build /app /app
CMD ["node", "deploy/development/entrypoint.mjs", "runtime"]
