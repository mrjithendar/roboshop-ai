#!/bin/sh
# Executed inside the WP-CLI container; secrets stay out of command arguments/logs.
set -eu
attempt=0
until [ -s wp-config.php ] && [ -f wp-includes/version.php ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || { echo 'WordPress files were not initialized.' >&2; exit 1; }
  sleep 2
done
if ! wp core is-installed; then
  printf '%s\n' "$WP_ADMIN_PASSWORD" | wp core install \
    --url="$WP_URL" --title="$WP_TITLE" --admin_user="$WP_ADMIN_USER" \
    --admin_email="$WP_ADMIN_EMAIL" --skip-email --prompt=admin_password
fi
if ! wp plugin is-installed redis-cache; then
  wp plugin install redis-cache --version="$REDIS_PLUGIN_VERSION"
fi
wp plugin activate redis-cache
wp redis enable
# Two separate processes verify that objects persist in Redis, not just PHP memory.
wp cache set roboshop-cache-check connected roboshop-deploy 30
[ "$(wp cache get roboshop-cache-check roboshop-deploy)" = connected ]
wp cache delete roboshop-cache-check roboshop-deploy
wp redis status
