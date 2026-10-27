# syntax=docker/dockerfile:1
# Built for linux/arm64 (mk4 nodes). Run from sites/jithendar-com.

FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:26-alpine AS build
WORKDIR /app
# APP_ENV is baked into the meta robots tag at build time; production is the only indexable value.
ARG APP_ENV=production
ENV APP_ENV=$APP_ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:26-alpine AS runtime
WORKDIR /app
# Reported by /api/health so CI can confirm which build is live.
ARG GIT_SHA=dev
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 GIT_SHA=$GIT_SHA
# Standalone output already contains server.js, traced node_modules and content/.
COPY --from=build --chown=1000:1000 /app/.next/standalone ./
COPY --from=build --chown=1000:1000 /app/.next/static ./.next/static
COPY --from=build --chown=1000:1000 /app/public ./public
USER 1000:1000
EXPOSE 3000
CMD ["node", "server.js"]
