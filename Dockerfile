FROM node:26-alpine
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node services ./services
COPY --chown=node:node frontend ./frontend
COPY --chown=node:node legacy/original-robotshop/web/static/images ./legacy/original-robotshop/web/static/images
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 3000
CMD ["node", "services/ai-gateway/server.mjs"]
