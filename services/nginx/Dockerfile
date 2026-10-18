FROM nginx:1.28-alpine
COPY services/nginx/ /etc/nginx/robotshop/
COPY frontend/ /usr/share/nginx/html/
COPY legacy/original-robotshop/web/static/images/ /usr/share/nginx/html/images/
# All runtime files go into /tmp. No root privileges or writable image needed.
USER 101:101
EXPOSE 8080 8443
ENTRYPOINT ["/bin/sh", "/etc/nginx/robotshop/start.sh"]
