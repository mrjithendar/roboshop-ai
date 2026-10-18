# Build from the repository root: docker build -f services/mcp-server/Dockerfile .
FROM node:26-alpine
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --chown=node:node services/shared/ ./services/shared/
COPY --chown=node:node services/mcp-server/ ./services/mcp-server/
USER node
CMD ["node", "services/mcp-server/server.mjs"]
