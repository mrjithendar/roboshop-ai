# Build from the repository root: docker build -f services/payment-service/Dockerfile .
FROM node:26-alpine
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --chown=node:node services/shared/ ./services/shared/
COPY --chown=node:node services/payment-service/ ./services/payment-service/
USER node
EXPOSE 4105
CMD ["node", "services/payment-service/server.mjs"]
