# Build from the repository root: docker build -f services/catalogue-service/Dockerfile .
FROM node:26-alpine
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node services/shared/ ./services/shared/
COPY --chown=node:node services/catalogue-service/ ./services/catalogue-service/
USER node
EXPOSE 4108
CMD ["node", "services/catalogue-service/server.mjs"]
