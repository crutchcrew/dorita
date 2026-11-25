# Builds with Bun, runs on Node.js: Node's OpenSSL has the AES128-SHA256 cipher
# that many robots need and Bun's BoringSSL lacks (see "Runtime and TLS").
# One image for both setups: standalone (env vars, `docker run`) and the
# Home Assistant app in homeassistant/ (options in /data/options.json).

FROM oven/bun:1-slim AS deps
WORKDIR /src
COPY package.json bun.lock ./
COPY packages/dorita980/package.json ./packages/dorita980/
COPY packages/rest980/package.json ./packages/rest980/
COPY packages/mock-robot/package.json ./packages/mock-robot/
RUN bun install --frozen-lockfile --production

FROM deps AS build
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
RUN bun run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
# Bun's isolated linker keeps per-package node_modules symlinks into
# node_modules/.bun, so copy both levels.
COPY --from=deps /src/node_modules ./node_modules
COPY --from=deps /src/packages/dorita980/node_modules ./packages/dorita980/node_modules
COPY --from=deps /src/packages/rest980/node_modules ./packages/rest980/node_modules
COPY --from=build /src/package.json ./
COPY --from=build /src/packages/dorita980/package.json ./packages/dorita980/
COPY --from=build /src/packages/dorita980/dist ./packages/dorita980/dist
COPY --from=build /src/packages/rest980/package.json ./packages/rest980/
COPY --from=build /src/packages/rest980/dist ./packages/rest980/dist
COPY docker-entrypoint.sh /usr/local/bin/

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ping').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"]

# Starts as root only to make a root-only config file (Home Assistant's
# options.json) readable, then runs as `node`. `docker run --user` skips that.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "packages/rest980/dist/bin/rest980.js"]
