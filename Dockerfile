FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json ./
COPY src/ src/
RUN npx esbuild src/server/prod-server.ts --bundle --platform=node --format=esm --outfile=dist-server/server-bundle.mjs '--external:@aws-sdk/*' --external:express --external:ws --external:uuid

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist-server/server-bundle.mjs ./dist-server/
# Drop root. The node:22-alpine image ships an unprivileged `node` user (uid
# 1000); the bundle and node_modules are world-readable, and the server writes
# nothing to disk, so no chown is needed.
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3001/api/health || exit 1
CMD ["node", "dist-server/server-bundle.mjs"]
