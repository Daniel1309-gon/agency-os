#!/bin/sh
# Guarda los cuerpos subidos bajo su clave S3 para el ensayo local de restore.
set -eu

key=
body=
mode=
retain_until=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --key) key="$2"; shift 2 ;;
    --body) body="$2"; shift 2 ;;
    --object-lock-mode) mode="$2"; shift 2 ;;
    --object-lock-retain-until-date) retain_until="$2"; shift 2 ;;
    *) shift ;;
  esac
done

[ -n "$key" ] && [ -n "$body" ] && [ -n "${AWS_STUB_DEST:-}" ] || exit 2
case "$key" in
  *"${AWS_STUB_FAIL_SUFFIX:-__never_match__}") exit 1 ;;
esac
target="$AWS_STUB_DEST/$key"
mkdir -p "$(dirname "$target")"
cp "$body" "$target"
if [ -n "$mode" ]; then
  printf '%s %s\n' "$mode" "$retain_until" > "$target.lock"
fi
