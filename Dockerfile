# PRIMEXA FNO Dashboard — API + pre-built web (optional: serve web via nginx separately)
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/web ./apps/web

RUN npm ci

RUN npm run build -w @option-dashboard/shared
RUN npm run build -w @option-dashboard/api

# Build SPA — set API URL at build time (override in CI/host)
ARG VITE_API_BASE_URL=https://api.primexalearning.in
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build -w @option-dashboard/web

# Runtime: Node API only (serve static files with a CDN or second container)
FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 4000

CMD ["node", "apps/api/dist/index.js"]
