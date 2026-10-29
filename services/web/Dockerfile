# One image: the storefront's static build output plus the NGINX that serves it
# and proxies /api to the gateway. Build context: services/web.
FROM node:26-alpine AS assets
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build

FROM nginx:1.31-alpine
# Only configuration templates and generated files; no Node, sources or dev dependencies.
COPY nginx/ /etc/nginx/roboshop/
COPY --from=assets /app/dist/ /usr/share/nginx/html/
USER 101:101
EXPOSE 8080 8443
ENTRYPOINT ["/bin/sh", "/etc/nginx/roboshop/start.sh"]
