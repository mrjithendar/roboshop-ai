#!/bin/sh
set -eu
export NGINX_CONFIG_DIR="${NGINX_CONFIG_DIR:-/etc/nginx/robotshop}"
export NGINX_RUN_DIR="${NGINX_RUN_DIR:-/tmp/robotshop-nginx}"
export NGINX_WEB_ROOT="${NGINX_WEB_ROOT:-/usr/share/nginx/html}"
export NGINX_MIME_TYPES="${NGINX_MIME_TYPES:-/etc/nginx/mime.types}"
export NGINX_TLS_CERT_FILE="${NGINX_TLS_CERT_FILE:-/etc/nginx/tls/tls.crt}"
export NGINX_TLS_KEY_FILE="${NGINX_TLS_KEY_FILE:-/etc/nginx/tls/tls.key}"
export NGINX_HTTP_PORT="${NGINX_HTTP_PORT:-8080}"
export NGINX_HTTPS_PORT="${NGINX_HTTPS_PORT:-8443}"
export GATEWAY_HOST="${GATEWAY_HOST:-ai-gateway}"
export GATEWAY_PORT="${GATEWAY_PORT:-3000}"
export NGINX_SERVER_NAME="${NGINX_SERVER_NAME:-localhost}"
export NGINX_RESOLVER="${NGINX_RESOLVER:-$(awk '/^nameserver / {print $2; exit}' /etc/resolv.conf)}"
# Values are inserted into configuration: reject directive injection.
for name in "$GATEWAY_HOST" "$NGINX_SERVER_NAME"; do
    case "$name" in ''|*[!a-zA-Z0-9.-]*) echo 'Invalid hostname' >&2; exit 1;; esac
done
case "$NGINX_RESOLVER" in ''|*[!0-9a-fA-F.:\[\]]*) echo 'Invalid DNS resolver' >&2; exit 1;; esac
for port in "$GATEWAY_PORT" "$NGINX_HTTP_PORT" "$NGINX_HTTPS_PORT"; do
    case "$port" in ''|*[!0-9]*) echo 'Invalid port' >&2; exit 1;; esac
    [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || exit 1
done
mkdir -p "$NGINX_RUN_DIR/http" "$NGINX_RUN_DIR/snippets"
# Substitute ONLY our settings. Preserve NGINX variables such as $uri/$scheme.
vars='${NGINX_TLS_CERT_FILE} ${NGINX_TLS_KEY_FILE} ${NGINX_RUN_DIR} ${NGINX_WEB_ROOT} ${NGINX_MIME_TYPES} ${NGINX_HTTP_PORT} ${NGINX_HTTPS_PORT} ${NGINX_RESOLVER} ${GATEWAY_HOST} ${GATEWAY_PORT} ${NGINX_SERVER_NAME}'
for source in "$NGINX_CONFIG_DIR/nginx.conf" "$NGINX_CONFIG_DIR"/http/*.conf "$NGINX_CONFIG_DIR"/snippets/*.conf; do
    relative="${source#"$NGINX_CONFIG_DIR/"}"
    envsubst "$vars" < "$source" > "$NGINX_RUN_DIR/$relative"
done
mode=http
if [ "${NGINX_TLS:-false}" = true ]; then mode=https; fi
envsubst "$vars" < "$NGINX_CONFIG_DIR/servers/$mode.conf" > "$NGINX_RUN_DIR/server.conf"
nginx -t -c "$NGINX_RUN_DIR/nginx.conf"
if [ "${1:-}" = --test ]; then exit 0; fi
exec nginx -c "$NGINX_RUN_DIR/nginx.conf" -g 'daemon off;'
