# syntax=docker/dockerfile:1.7
# LDMS API + worker. Build from stelco-ldms/: docker build -f infra/docker/api.Dockerfile --target api .
FROM node:22.23.5-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /src

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api... --filter @ldms/shared
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @ldms/shared build && pnpm --filter api prisma:generate && pnpm --filter api build \
 && pnpm --filter api deploy --prod --legacy /out && cp -r apps/api/dist apps/api/dist-tools apps/api/prisma apps/api/data apps/api/scripts /out/ \
 && cd /out && npx prisma generate --schema prisma/schema.prisma

FROM node:22.23.5-bookworm-slim AS api
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/* \
 && groupadd -r ldms && useradd -r -g ldms -d /app -s /usr/sbin/nologin ldms \
 # SECURITY: package managers are build-time only. Removing npm/npx/corepack/yarn from the runtime
 # image drops their bundled dependencies (e.g. node-tar CVEs flagged by Trivy) and leaves an attacker
 # who gets code execution no installer to fetch tooling with.
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build --chown=root:root /out /app
USER ldms
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]

# Worker: same code + text extraction / OCR tools. Runs with no inbound ports.
FROM api AS worker
USER root
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
USER ldms
HEALTHCHECK NONE
CMD ["node", "dist/main.worker.js"]
