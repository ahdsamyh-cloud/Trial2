#!/usr/bin/env bash
# LDMS logical backup: database dump + document store, encrypted (AES-256, PBKDF2) with a manifest.
# Complements continuous WAL archiving (pgBackRest) which gives the 15-minute RPO; this gives
# portable, verifiable daily snapshots. Run from cron/systemd on the backup host.
#
#   DATABASE_URL=postgresql://ldms_backup:...@db:5432/ldms \   # role with BYPASSRLS + SELECT (see 04_grants.sql)
#   STORAGE_DIR=/srv/ldms/storage            # or S3_ALIAS=ldms (MinIO client alias) + S3_BUCKETS="ldms-documents"
#   BACKUP_DIR=/backup/ldms  PASSPHRASE_FILE=/etc/ldms/backup.pass  ./backup.sh
set -euo pipefail
umask 077
: "${DATABASE_URL:?}" "${BACKUP_DIR:?}" "${PASSPHRASE_FILE:?}"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$BACKUP_DIR/$stamp"
mkdir -p "$out"
trap '[[ $? -ne 0 ]] && rm -rf "$out" && echo "[backup] FAILED — partial set removed" >&2' EXIT
enc() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$PASSPHRASE_FILE" -out "$1"; }

echo "[backup] database"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" | enc "$out/db.dump.enc"

if [[ -n "${STORAGE_DIR:-}" ]]; then
  echo "[backup] document store (filesystem)"
  tar -C "$STORAGE_DIR" -cf - . | enc "$out/storage.tar.enc"
elif [[ -n "${S3_ALIAS:-}" ]]; then
  echo "[backup] document store (S3 mirror)"
  tmp=$(mktemp -d)
  for b in ${S3_BUCKETS:-ldms-documents}; do mc mirror --quiet "$S3_ALIAS/$b" "$tmp/$b"; done
  tar -C "$tmp" -cf - . | enc "$out/storage.tar.enc"
  rm -rf "$tmp"
fi

( cd "$out" && sha256sum ./*.enc > SHA256SUMS )
echo "{\"created\":\"$stamp\",\"files\":$(ls "$out" | grep -c enc)}" > "$out/manifest.json"
# Retention of backup sets: keep 35 daily sets
ls -1d "$BACKUP_DIR"/*/ 2>/dev/null | sort | head -n -35 | xargs -r rm -rf
echo "[backup] done: $out"
