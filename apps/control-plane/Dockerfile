FROM node:22.17.1-alpine@sha256:5539840ce9d013fa13e3b9814c9353024be7ac75aca5db6d039504a56c04ea59 AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/control-plane/package.json apps/control-plane/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile

COPY apps/control-plane apps/control-plane
COPY packages/core packages/core
RUN pnpm --filter @eventforge/core build \
    && pnpm --filter @eventforge/control-plane build \
    && pnpm --filter @eventforge/control-plane --prod deploy --legacy /opt/eventforge

FROM node:22.17.1-alpine@sha256:5539840ce9d013fa13e3b9814c9353024be7ac75aca5db6d039504a56c04ea59 AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /opt/eventforge ./
RUN mkdir -p /workspaces && chown node:node /workspaces

USER node
EXPOSE 4310
CMD ["node", "dist/index.js"]
