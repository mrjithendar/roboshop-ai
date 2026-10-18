FROM node:26-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY services/frontend ./services/frontend
COPY scripts/build-frontend.mjs ./scripts/build-frontend.mjs
RUN npm run frontend:build

FROM node:26-alpine
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node services ./services
COPY --chown=node:node scripts/bootstrap-admin.mjs ./scripts/bootstrap-admin.mjs
COPY --from=frontend-build --chown=node:node /app/services/frontend/dist ./services/frontend/dist
COPY --chown=node:node legacy/original-robotshop/web/static/images ./legacy/original-robotshop/web/static/images
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 3000
CMD ["node", "services/ai-gateway/server.mjs"]
