#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
sentinel='VITE_ENCRYPTION_KEY_SENTINEL_SHOULD_NEVER_REACH_BROWSER'
if ! (
  cd "$repo_root"
  VITE_API_URL='https://api.example.test' \
    VITE_ENCRYPTION_KEY="$sentinel" \
    npm run build:prod >/dev/null
); then
  printf 'FAIL: production build must succeed with VITE_API_URL and no browser encryption key dependency\n' >&2
  exit 1
fi

if rg -F "$sentinel" "$repo_root/dist" >/dev/null 2>&1; then
  printf 'FAIL: VITE_ENCRYPTION_KEY sentinel was embedded in production assets\n' >&2
  exit 1
fi

printf 'PASS: production build succeeds and does not embed VITE_ENCRYPTION_KEY\n'
