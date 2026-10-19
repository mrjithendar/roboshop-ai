# Build from the repository root: docker build -f services/sre-copilot/Dockerfile .
FROM node:26-alpine
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --chown=node:node services/shared/ ./services/shared/
COPY --chown=node:node services/sre-copilot/ ./services/sre-copilot/
USER node
EXPOSE 4104
CMD ["node", "services/sre-copilot/server.mjs"]
