# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS web-build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web-app/package.json web-app/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=agency-os-pnpm,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --filter agency-os-web...

COPY web-app web-app
COPY packages/shared packages/shared
ARG VITE_API_BASE_URL=https://api.agency-os.test/api/v1
ARG VITE_EXTENSION_ID
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_EXTENSION_ID=$VITE_EXTENSION_ID
RUN pnpm --filter @agency-os/shared build && pnpm --filter agency-os-web build

FROM nginx:1.29-alpine
COPY deploy/station-e2e/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /workspace/web-app/dist/ /usr/share/nginx/html/
RUN mkdir -p /srv/extension
EXPOSE 443
