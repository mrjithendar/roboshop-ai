#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password SHIPPING_APP_PASSWORD
CREATE ROLE shipping_app LOGIN PASSWORD :'app_password';
CREATE SCHEMA shipping AUTHORIZATION shipping;
GRANT USAGE ON SCHEMA shipping TO shipping_app;
ALTER DEFAULT PRIVILEGES FOR ROLE shipping IN SCHEMA shipping GRANT SELECT ON TABLES TO shipping_app;
SQL
