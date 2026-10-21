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
  # Read credentials inside PHP: WP-CLI's interactive prompt echoes passwords.
  wp eval '
    add_filter("pre_wp_mail", "__return_true");
    require_once ABSPATH . "wp-admin/includes/upgrade.php";
    wp_install(getenv("WP_TITLE"), getenv("WP_ADMIN_USER"),
      getenv("WP_ADMIN_EMAIL"), true, "", getenv("WP_ADMIN_PASSWORD"));
  '
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
