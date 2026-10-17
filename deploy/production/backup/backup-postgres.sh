#!/bin/sh
# Backup consistente de PostgreSQL para Agency OS (plan 2026-09-20, fase E).
#
# - pg_dump en formato custom (consistente; nunca copiar archivos en caliente).
# - Comprime y cifra ANTES de salir del VPS (AES-256 con PBKDF2).
# - Sube a Backblaze B2 por S3 con Object Lock (GOVERNANCE) y retencion.
# - Escribe un manifiesto con version, inicio, checksum y resultado.
#
# Modos:
#   backup-postgres.sh            ciclo completo (uso normal, cada 30 min)
#   backup-postgres.sh --check    falla si la ultima copia exitosa es vieja o inexistente;
#                                 los intentos fallidos no cuentan ni pisan ese manifiesto
#
# Variables requeridas: DATABASE_URL, BACKUP_ENCRYPTION_PASSPHRASE,
# B2_ENDPOINT, B2_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
set -eu

FREQUENT_RETENTION_HOURS="${FREQUENT_RETENTION_HOURS:-24}"
DAILY_RETENTION_DAYS="${DAILY_RETENTION_DAYS:-30}"
MAX_AGE_MINUTES="${MAX_AGE_MINUTES:-45}"
WORKDIR="${BACKUP_WORKDIR:-/var/lib/agency-os-backup}"
STATUS_FILE="$WORKDIR/last-backup.json"
FAILURE_FILE="$WORKDIR/last-failure.json"
PG_DUMP="${PG_DUMP:-pg_dump}"
PG_DUMPALL="${PG_DUMPALL:-pg_dumpall}"
OPENSSL="${OPENSSL:-openssl}"
AWS="${AWS:-aws}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"; }
fail() { log "ERROR: $1"; exit 1; }

require_env() {
  for name in "$@"; do
    eval "value=\${$name:-}"
    [ -n "$value" ] || fail "falta $name"
  done
}

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
stamp() { date -u +%Y%m%dT%H%M%SZ; }
retention_iso() {
  # $1 = horas o dias; $2 = unidad. BusyBox date solo acepta -d @<epoch>.
  if [ "$2" = "hours" ]; then
    seconds=$(( $1 * 3600 ))
  else
    seconds=$(( $1 * 86400 ))
  fi
  date -u -d "@$(( $(date -u +%s) + seconds ))" +%Y-%m-%dT%H:%M:%SZ
}

check_mode() {
  require_env MAX_AGE_MINUTES
  [ -f "$STATUS_FILE" ] || fail "no hay registro de backups ($STATUS_FILE)"
  result="$(sed -n 's/.*"result": *"\([A-Z_]*\)".*/\1/p' "$STATUS_FILE" | head -n 1)"
  [ "$result" = "SUCCESS" ] || fail "la ultima copia registrada no fue exitosa (result=${result:-desconocido})"
  finished_epoch="$(sed -n 's/.*"finishedEpoch": *\([0-9]*\).*/\1/p' "$STATUS_FILE" | head -n 1)"
  [ -n "$finished_epoch" ] || fail "el registro de backups no tiene finishedEpoch"
  age_minutes=$(( ( $(date -u +%s) - finished_epoch ) / 60 ))
  if [ "$age_minutes" -gt "$MAX_AGE_MINUTES" ]; then
    fail "la ultima copia completada tiene ${age_minutes} min (limite ${MAX_AGE_MINUTES})"
  fi
  log "backup fresco: ${age_minutes} min"
}

main() {
  require_env DATABASE_URL BACKUP_ENCRYPTION_PASSPHRASE B2_ENDPOINT B2_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
  mkdir -p "$WORKDIR"
  started_at="$(now_iso)"
  name="agency-os-$(stamp)"
  raw="$WORKDIR/$name.dump"
  encrypted="$raw.enc"
  checksum_file="$encrypted.sha256"
  globals_raw="$WORKDIR/$name.globals.sql"
  globals_encrypted="$globals_raw.enc"
  globals_checksum_file="$globals_encrypted.sha256"
  manifest_tmp="$WORKDIR/.manifest.tmp"
  # La copia diaria se sube una vez por dia UTC, no en cada ciclo de 30 min.
  daily_state="$WORKDIR/last-daily-date"
  today="$(date -u +%F)"
  daily_due=true
  if [ -f "$daily_state" ] && [ "$(cat "$daily_state")" = "$today" ]; then daily_due=false; fi
  version="$(sed -n 's/^AGENCY_OS_VERSION=//p' "$WORKDIR/version" 2>/dev/null || true)"
  version="${version:-unknown}"

  # Frecuente (24 h) y diaria (30 dias): el mismo dump alimenta ambas rutas.
  frequent_key="frequent/$name.dump.enc"
  daily_key="daily/$name.dump.enc"
  frequent_globals_key="frequent/$name.globals.sql.enc"
  daily_globals_key="daily/$name.globals.sql.enc"
  frequent_until="$(retention_iso "$FREQUENT_RETENTION_HOURS" hours)"
  daily_until="$(retention_iso "$DAILY_RETENTION_DAYS" days)"

  cleanup() { rm -f "$raw" "$encrypted" "$checksum_file" "$globals_raw" "$globals_encrypted" "$globals_checksum_file" "$manifest_tmp"; }
  trap cleanup EXIT

  log "dump $name (version $version)"
  "$PG_DUMP" --format=custom --file "$raw" "$DATABASE_URL" || {
    write_manifest "$FAILURE_FILE" "$started_at" "$name" "" "FAILED_DUMP"
    fail "pg_dump fallo"
  }
  # Globals (roles, membresias, tablespaces): sin ellos un restore en servidor
  # vacio no puede recrear los roles de runtime. Las contrasenas de rol se
  # omiten a proposito y se restablecen desde el .env.production (README).
  "$PG_DUMPALL" --globals-only --no-role-passwords --file "$globals_raw" --dbname "$DATABASE_URL" || {
    write_manifest "$FAILURE_FILE" "$started_at" "$name" "" "FAILED_GLOBALS"
    fail "pg_dumpall --globals-only fallo"
  }

  "$OPENSSL" enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
    -in "$raw" -out "$encrypted" -pass env:BACKUP_ENCRYPTION_PASSPHRASE || {
    write_manifest "$FAILURE_FILE" "$started_at" "$name" "" "FAILED_ENCRYPT"
    fail "el cifrado fallo"
  }
  checksum="$("$OPENSSL" dgst -sha256 "$encrypted" | awk '{print $NF}')"
  printf '%s  %s\n' "$checksum" "$name.dump.enc" > "$checksum_file"

  "$OPENSSL" enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
    -in "$globals_raw" -out "$globals_encrypted" -pass env:BACKUP_ENCRYPTION_PASSPHRASE || {
    write_manifest "$FAILURE_FILE" "$started_at" "$name" "" "FAILED_ENCRYPT"
    fail "el cifrado de globals fallo"
  }
  globals_checksum="$("$OPENSSL" dgst -sha256 "$globals_encrypted" | awk '{print $NF}')"
  printf '%s  %s\n' "$globals_checksum" "$name.globals.sql.enc" > "$globals_checksum_file"

  upload() {
    key="$1"; until="$2"; body="$3"
    "$AWS" --endpoint-url "$B2_ENDPOINT" s3api put-object \
      --bucket "$B2_BUCKET" --key "$key" --body "$body" \
      --object-lock-mode GOVERNANCE --object-lock-retain-until-date "$until" >/dev/null || return 1
  }

  if ! upload "$frequent_key" "$frequent_until" "$encrypted" || \
     ! upload "$frequent_key.sha256" "$frequent_until" "$checksum_file" || \
     ! upload "$frequent_globals_key" "$frequent_until" "$globals_encrypted" || \
     ! upload "$frequent_globals_key.sha256" "$frequent_until" "$globals_checksum_file"; then
    write_manifest "$FAILURE_FILE" "$started_at" "$name" "$checksum" "FAILED_UPLOAD_FREQUENT"
    notify_heartbeat fail
    fail "no se pudo subir la copia frecuente"
  fi
  if [ "$daily_due" = "true" ]; then
    if ! upload "$daily_key" "$daily_until" "$encrypted" || \
       ! upload "$daily_key.sha256" "$daily_until" "$checksum_file" || \
       ! upload "$daily_globals_key" "$daily_until" "$globals_encrypted" || \
       ! upload "$daily_globals_key.sha256" "$daily_until" "$globals_checksum_file"; then
      write_manifest "$FAILURE_FILE" "$started_at" "$name" "$checksum" "FAILED_UPLOAD_DAILY"
      notify_heartbeat fail
      fail "no se pudo subir la copia diaria"
    fi
    printf '%s\n' "$today" > "$daily_state"
  else
    log "copia diaria de $today ya subida; se omite"
  fi

  # Cada objeto cifrado ya tiene su checksum retenido en B2. El manifiesto
  # queda como puntero mutable a la ultima corrida exitosa.
  write_manifest "$manifest_tmp" "$started_at" "$name" "$checksum" "SUCCESS" "$globals_checksum" "$daily_due"
  if ! "$AWS" --endpoint-url "$B2_ENDPOINT" s3api put-object \
      --bucket "$B2_BUCKET" --key "manifest/last-backup.json" --body "$manifest_tmp" >/dev/null; then
    write_manifest "$FAILURE_FILE" "$started_at" "$name" "$checksum" "FAILED_MANIFEST_UPLOAD" "$globals_checksum"
    notify_heartbeat fail
    fail "no se pudo subir el manifiesto a B2"
  fi
  mv "$manifest_tmp" "$STATUS_FILE"

  notify_heartbeat success
  log "backup completado: $name (sha256 $checksum)"
}

# Heartbeat externo (Healthchecks.io y similares): si deja de llegar el ping de
# exito, el monitor alerta a Daniel. Nunca imprime la URL ni su contenido.
notify_heartbeat() {
  [ -n "${BACKUP_HEARTBEAT_URL:-}" ] || return 0
  url="$BACKUP_HEARTBEAT_URL"
  [ "$1" = "fail" ] && url="$BACKUP_HEARTBEAT_URL/fail"
  wget -q -O /dev/null --timeout=10 "$url" || true
}

write_manifest() {
  target="$1"; started_at="$2"; name="$3"; checksum="$4"; result="$5"; globals_checksum="${6:-}"; daily_uploaded="${7:-false}"
  finished_at="$(now_iso)"
  finished_epoch="$(date -u +%s)"
  cat > "$target" <<EOF
{
  "version": "$version",
  "name": "$name",
  "startedAt": "$started_at",
  "finishedAt": "$finished_at",
  "finishedEpoch": $finished_epoch,
  "sha256": "$checksum",
  "globalsSha256": "$globals_checksum",
  "dailyUploaded": $daily_uploaded,
  "result": "$result"
}
EOF
}

case "${1:-}" in
  --check) check_mode ;;
  --once|"") main ;;
  *) fail "uso: $0 [--once|--check]" ;;
esac
