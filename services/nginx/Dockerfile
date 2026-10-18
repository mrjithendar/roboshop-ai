FROM node:26-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY services/frontend ./services/frontend
COPY scripts/build-frontend.mjs ./scripts/build-frontend.mjs
RUN npm run frontend:build

FROM nginx:1.28-alpine
COPY services/nginx/ /etc/nginx/robotshop/
COPY --from=frontend-build /app/services/frontend/dist/ /usr/share/nginx/html/
COPY legacy/original-robotshop/web/static/images/ /usr/share/nginx/html/images/
# All runtime files go into /tmp. No root privileges or writable image needed.
USER 101:101
EXPOSE 8080 8443
ENTRYPOINT ["/bin/sh", "/etc/nginx/robotshop/start.sh"]
