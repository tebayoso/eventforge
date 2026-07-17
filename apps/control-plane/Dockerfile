FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/control-plane/package.json apps/control-plane/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm --filter @eventforge/control-plane build
EXPOSE 4310
CMD ["pnpm", "--filter", "@eventforge/control-plane", "start"]
