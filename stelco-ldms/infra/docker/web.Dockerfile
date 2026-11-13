# syntax=docker/dockerfile:1.7
FROM node:22.20-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /src
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web... --filter @ldms/shared
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @ldms/shared build && pnpm --filter web build

FROM node:22.20-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/* \
 && groupadd -r ldms && useradd -r -g ldms -d /app -s /usr/sbin/nologin ldms
WORKDIR /app
COPY --from=build /src/apps/web/.next/standalone ./
COPY --from=build /src/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /src/apps/web/public ./apps/web/public
USER ldms
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
