FROM nginx:1.28-alpine
COPY services/nginx/ /etc/nginx/robotshop/
USER 101:101
EXPOSE 8080 8443
ENTRYPOINT ["/bin/sh", "/etc/nginx/robotshop/start.sh"]
