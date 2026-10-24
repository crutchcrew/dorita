FROM oven/bun:1-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock ./
COPY packages/dorita980/package.json ./packages/dorita980/
COPY packages/rest980/package.json ./packages/rest980/
COPY packages/mock-robot/package.json ./packages/mock-robot/
RUN bun install --frozen-lockfile --production

# Bun runs the TypeScript sources directly. The `paths` in rest980's tsconfig
# point the dorita980 import at its sources instead of the unbuilt dist/.
COPY tsconfig.base.json ./
COPY packages/rest980/tsconfig.json ./packages/rest980/
COPY packages/dorita980/index.ts ./packages/dorita980/
COPY packages/dorita980/lib ./packages/dorita980/lib
COPY packages/rest980/bin ./packages/rest980/bin
COPY packages/rest980/server ./packages/rest980/server
COPY packages/rest980/web ./packages/rest980/web

# Configure with BLID, PASSWORD, ROBOT_IP, FIRMWARE_VERSION, ... (see README).
ENV PORT=3000
EXPOSE 3000

USER bun

CMD ["bun", "packages/rest980/bin/rest980.ts"]
