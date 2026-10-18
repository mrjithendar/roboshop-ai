# Build from the repository root: docker build -f services/shopping-agent/Dockerfile .
FROM node:26-alpine
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --chown=node:node services/shared/ ./services/shared/
COPY --chown=node:node services/shopping-agent/ ./services/shopping-agent/
USER node
EXPOSE 4103
CMD ["node", "services/shopping-agent/server.mjs"]
