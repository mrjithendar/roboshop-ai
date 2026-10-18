# Build from the repository root: docker build -f services/ai-gateway/Dockerfile .
FROM node:26-alpine
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node services/shared/ ./services/shared/
COPY --chown=node:node services/ai-gateway/ ./services/ai-gateway/
COPY --chown=node:node scripts/bootstrap-admin.mjs ./scripts/bootstrap-admin.mjs
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 3000
CMD ["node", "services/ai-gateway/server.mjs"]
