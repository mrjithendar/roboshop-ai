FROM node:26-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY services/frontend ./services/frontend
COPY scripts/build-frontend.mjs ./scripts/build-frontend.mjs
RUN npm run frontend:build

FROM nginx:1.28-alpine
COPY services/frontend/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-build /app/services/frontend/dist/ /usr/share/nginx/html/
COPY legacy/original-robotshop/web/static/images/ /usr/share/nginx/html/images/
USER 101:101
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
