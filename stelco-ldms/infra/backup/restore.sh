#!/usr/bin/env bash
# Restore an LDMS backup set into a database + storage directory, then verify it.
#   SET=/backup/ldms/20261113T020000Z TARGET_DATABASE_URL=postgresql://ldms_owner:...@db:5432/ldms_restore \
#   TARGET_STORAGE_DIR=/srv/ldms-restore/storage PASSPHRASE_FILE=/etc/ldms/backup.pass APP_DB_ROLE=ldms_app ./restore.sh
set -euo pipefail
: "${SET:?}" "${TARGET_DATABASE_URL:?}" "${PASSPHRASE_FILE:?}"
here=$(cd "$(dirname "$0")" && pwd)
api="$here/../../apps/api"
dec() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASSPHRASE_FILE" -in "$1"; }

echo "[restore] checking integrity"
( cd "$SET" && sha256sum -c SHA256SUMS )

echo "[restore] database"
dec "$SET/db.dump.enc" | pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="$TARGET_DATABASE_URL"
( cd "$api" && DATABASE_URL="$TARGET_DATABASE_URL" node scripts/apply-sql.js )

if [[ -f "$SET/storage.tar.enc" && -n "${TARGET_STORAGE_DIR:-}" ]]; then
  echo "[restore] document store"
  mkdir -p "$TARGET_STORAGE_DIR"
  dec "$SET/storage.tar.enc" | tar -C "$TARGET_STORAGE_DIR" -xf -
fi

echo "[restore] verifying"
( cd "$api" && DATABASE_URL="$TARGET_DATABASE_URL" STORAGE_FS_ROOT="${TARGET_STORAGE_DIR:-}" node $( [ -f dist-tools/scripts/verify-restore.js ] && echo dist-tools/scripts/verify-restore.js || echo "-r @swc-node/register scripts/verify-restore.ts" ) )
