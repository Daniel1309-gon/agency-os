#!/bin/sh
set -eu

load_secret() {
  variable="$1"
  file_variable="${variable}_FILE"
  file_path="$(printenv "$file_variable" 2>/dev/null || true)"
  if [ -z "$file_path" ]; then
    return
  fi
  if [ ! -f "$file_path" ]; then
    echo "Required secret file for $variable is missing" >&2
    exit 1
  fi
  value="$(cat "$file_path")"
  if [ -z "$value" ]; then
    echo "Required secret file for $variable is empty" >&2
    exit 1
  fi
  export "$variable=$value"
  unset "$file_variable"
}

for variable in \
  DATABASE_URL DATABASE_APP_URL DATABASE_WORKER_URL DATABASE_READONLY_URL \
  DATABASE_RUNTIME_PASSWORD DATABASE_WORKER_PASSWORD \
  JWT_SECRET VAULT_KEK BOOTSTRAP_ADMIN_PASSWORD DEMO_USER_PASSWORD \
  ROCKETCHAT_TOKEN ROCKETCHAT_USER_ID
do
  load_secret "$variable"
done

exec "$@"

