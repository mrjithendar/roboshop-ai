# Build from the repository root: docker build -f services/product-ingestion/Dockerfile .
FROM node:26-alpine
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node services/shared/ ./services/shared/
COPY --chown=node:node services/product-ingestion/ ./services/product-ingestion/
USER node
EXPOSE 4101
CMD ["node", "services/product-ingestion/server.mjs"]
