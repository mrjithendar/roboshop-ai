# Build from the repository root: docker build -f services/recommendation-service/Dockerfile .
FROM node:26-alpine
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --chown=node:node services/shared/ ./services/shared/
COPY --chown=node:node services/recommendation-service/ ./services/recommendation-service/
USER node
EXPOSE 4102
CMD ["node", "services/recommendation-service/server.mjs"]
