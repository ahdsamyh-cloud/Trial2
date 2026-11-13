#!/bin/sh
# Dev-only database bootstrap (runs once, on an empty data volume).
# SECURITY: the app-role password comes from the environment (infra/.env), never from the repo.
# psql variables (:'app_pw') quote it safely, so any characters are allowed.
set -eu
: "${LDMS_APP_DB_PASSWORD:?set LDMS_APP_DB_PASSWORD in infra/.env}"
psql -v ON_ERROR_STOP=1 -v app_pw="$LDMS_APP_DB_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE ldms_app LOGIN PASSWORD :'app_pw';
ALTER ROLE ldms_owner CREATEDB;
CREATE DATABASE ldms_test OWNER ldms_owner;
SQL
