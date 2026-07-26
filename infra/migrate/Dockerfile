FROM node:22.16.0-bookworm-slim
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/db packages/db
CMD ["pnpm", "--filter", "@emergency-trial/db", "db:migrate"]
