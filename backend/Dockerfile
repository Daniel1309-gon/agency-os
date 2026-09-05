# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS toolchain

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

FROM toolchain AS build
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=agency-os-pnpm,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --filter @agency-os/api...

COPY backend backend
COPY packages/shared packages/shared
RUN pnpm --filter @agency-os/api... build
RUN pnpm deploy --filter @agency-os/api --prod --legacy /prod/api

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node --from=build /prod/api/ ./
COPY --chmod=755 backend/docker-entrypoint.sh /usr/local/bin/agency-os-entrypoint

USER node
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/agency-os-entrypoint"]
CMD ["node", "dist/main.js"]
