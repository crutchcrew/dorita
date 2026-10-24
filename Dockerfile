FROM oven/bun:1-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY index.js ./
COPY lib ./lib
COPY bin ./bin
COPY server ./server
COPY web ./web

# Configure with BLID, PASSWORD, ROBOT_IP, FIRMWARE_VERSION, ... (see README).
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "bin/rest980.js"]
