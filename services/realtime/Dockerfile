FROM node:22.16.0-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY services/realtime/package.json services/realtime/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/services/realtime/node_modules ./services/realtime/node_modules
COPY --from=deps /workspace/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /workspace/packages/db/node_modules ./packages/db/node_modules
COPY . .
RUN pnpm --filter @emergency-trial/realtime build

FROM node:22.16.0-bookworm-slim AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 1001 realtime \
  && useradd --system --uid 1001 --gid realtime realtime \
  && mkdir -p /data \
  && chown realtime:realtime /data
COPY --from=builder --chown=realtime:realtime /workspace/services/realtime/dist ./dist
USER realtime
EXPOSE 3001
CMD ["node", "dist/server.cjs"]
