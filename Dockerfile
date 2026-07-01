FROM node:22-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

FROM deps AS build

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS prod-deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOME=/data
ENV MEMORIX_DATA_DIR=/data/.memorix/data

WORKDIR /app

RUN mkdir -p /data /workspace \
  && chown -R node:node /data /workspace /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/README.md ./README.md
COPY --from=build --chown=node:node /app/README.zh-CN.md ./README.zh-CN.md
COPY --from=build --chown=node:node /app/LICENSE ./LICENSE
COPY --from=build --chown=node:node /app/CHANGELOG.md ./CHANGELOG.md
COPY --from=build --chown=node:node /app/CLAUDE.md ./CLAUDE.md
COPY --from=build --chown=node:node /app/llms.txt ./llms.txt
COPY --from=build --chown=node:node /app/llms-full.txt ./llms-full.txt

USER node

EXPOSE 3211
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 CMD ["node", "-e", "fetch('http://127.0.0.1:3211/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["serve-http", "--host", "0.0.0.0", "--port", "3211"]
