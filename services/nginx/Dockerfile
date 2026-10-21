FROM nginx:1.31-alpine
COPY ./ /etc/nginx/roboshop/
USER 101:101
EXPOSE 8080 8443
ENTRYPOINT ["/bin/sh", "/etc/nginx/roboshop/start.sh"]
