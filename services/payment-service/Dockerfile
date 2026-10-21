# Build context: this service directory.
FROM node:26-alpine
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app/services/payment-service
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node . ./
WORKDIR /app
USER node
EXPOSE 4105
CMD ["node", "services/payment-service/server.mjs"]
