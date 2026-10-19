{{- define "wordpress.env" -}}
- name: WORDPRESS_DB_HOST
  value: wordpress-mysql:3306
- name: WORDPRESS_DB_NAME
  value: wordpress
- name: WORDPRESS_DB_USER
  value: wordpress
- name: WORDPRESS_DB_PASSWORD
  valueFrom:
    secretKeyRef: {name: wordpress-credentials, key: database-password}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef: {name: wordpress-credentials, key: redis-password}
- name: WORDPRESS_CONFIG_EXTRA
  value: |
    define('WP_HOME', 'https://{{ .Values.host }}');
    define('WP_SITEURL', 'https://{{ .Values.host }}');
    define('FORCE_SSL_ADMIN', true);
    define('DISALLOW_FILE_EDIT', true);
    define('WP_REDIS_HOST', 'wordpress-redis');
    define('WP_REDIS_PASSWORD', getenv('REDIS_PASSWORD'));
    define('WP_REDIS_CLIENT', 'predis');
    define('WP_REDIS_PREFIX', 'jithendar-wordpress:');
    define('WP_REDIS_TIMEOUT', 1);
    define('WP_REDIS_READ_TIMEOUT', 1);
{{- end -}}
