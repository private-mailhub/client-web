#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf 'Usage: %s <40-character-sha> <frontend-archive.tar.gz>\n' "$0" >&2
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ $# -ne 2 ]]; then
  usage
  exit 64
fi

release_sha="$1"
archive="$2"

if [[ ! "$release_sha" =~ ^[[:xdigit:]]{40}$ ]]; then
  fail 'release SHA must contain exactly 40 hexadecimal characters'
fi
release_sha="$(printf '%s' "$release_sha" | tr '[:upper:]' '[:lower:]')"

if [[ ! -f "$archive" || -L "$archive" ]]; then
  fail 'release archive must be a regular file'
fi

deploy_root="${MAILHUB_DEPLOY_ROOT:-/var/www/mailhub-frontend}"
lock_file="${MAILHUB_DEPLOY_LOCK:-/var/lock/mailhub-deploy.lock}"
releases_dir="$deploy_root/releases"
shared_dir="$deploy_root/shared"
shared_assets_dir="$shared_dir/assets"
current_link="$deploy_root/current"
release_dir="$releases_dir/$release_sha"
umask 022

if [[ -z "$deploy_root" || "$deploy_root" == '/' ]]; then
  fail 'MAILHUB_DEPLOY_ROOT must identify a dedicated deployment directory'
fi
if [[ -L "$deploy_root" || -L "$releases_dir" || -L "$shared_dir" || -L "$shared_assets_dir" ]]; then
  fail 'deployment directories must not be symbolic links'
fi

lock_parent="$(dirname "$lock_file")"
mkdir -p "$lock_parent"
exec 9>"$lock_file"
if ! command -v flock >/dev/null 2>&1; then
  fail 'flock is required to serialize deployments'
fi
flock -x 9

mkdir -p "$releases_dir" "$shared_assets_dir"
if [[ -L "$deploy_root" || -L "$releases_dir" || -L "$shared_dir" || -L "$shared_assets_dir" ]]; then
  fail 'deployment directories must not be symbolic links'
fi
chmod 0755 "$deploy_root" "$releases_dir" "$shared_dir" "$shared_assets_dir"
if [[ -e "$release_dir" || -L "$release_dir" ]]; then
  fail "release already exists: $release_sha"
fi
if [[ -e "$current_link" && ! -L "$current_link" ]]; then
  fail 'current must be a symbolic link when it exists'
fi

staging_dir=''
current_tmp=''
archive_listing=''
archive_details=''
asset_tmp=''

cleanup() {
  set +e
  if [[ -n "$asset_tmp" && -e "$asset_tmp" ]]; then
    rm -f "$asset_tmp"
  fi
  if [[ -n "$current_tmp" && -e "$current_tmp" ]]; then
    rm -f "$current_tmp"
  fi
  if [[ -n "$staging_dir" && -d "$staging_dir" ]]; then
    rm -rf "$staging_dir"
  fi
  if [[ -n "$archive_listing" && -e "$archive_listing" ]]; then
    rm -f "$archive_listing"
  fi
  if [[ -n "$archive_details" && -e "$archive_details" ]]; then
    rm -f "$archive_details"
  fi
}
trap cleanup EXIT

archive_listing="$(mktemp "${TMPDIR:-/tmp}/mailhub-frontend-archive.XXXXXX")"
archive_details="$(mktemp "${TMPDIR:-/tmp}/mailhub-frontend-details.XXXXXX")"
if ! tar -tzf "$archive" > "$archive_listing"; then
  fail 'unable to read release archive'
fi

entry_count=0
while IFS= read -r entry || [[ -n "$entry" ]]; do
  entry_count=$((entry_count + 1))
  case "$entry" in
    *'//'*)
      fail "archive contains a traversal path: $entry"
      ;;
  esac
  case "/$entry/" in
    *'/../'*|*'/./'*)
      fail "archive contains a traversal path: $entry"
      ;;
  esac
  case "$entry" in
    dist|dist/*)
      ;;
    *)
      fail "archive contains an unexpected path: $entry"
      ;;
  esac
done < "$archive_listing"
if (( entry_count == 0 )); then
  fail 'release archive is empty'
fi

if ! tar -tvzf "$archive" > "$archive_details"; then
  fail 'unable to inspect release archive entries'
fi
while IFS= read -r entry_details || [[ -n "$entry_details" ]]; do
  [[ -n "$entry_details" ]] || continue
  entry_type="${entry_details:0:1}"
  case "$entry_type" in
    d|-)
      ;;
    *)
      fail 'release archive contains a link or unsupported filesystem entry'
      ;;
  esac
done < "$archive_details"

staging_dir="$(mktemp -d "$releases_dir/.${release_sha}.tmp.XXXXXX")"
if ! tar -xzf "$archive" \
  --directory "$staging_dir" \
  --strip-components=1 \
  --no-same-owner \
  --no-same-permissions; then
  fail 'unable to extract release archive'
fi

if [[ ! -f "$staging_dir/index.html" || -L "$staging_dir/index.html" ]]; then
  fail 'release must contain a regular index.html'
fi
if [[ ! -d "$staging_dir/assets" || -L "$staging_dir/assets" ]]; then
  fail 'release must contain an assets directory'
fi

while IFS= read -r extracted_path || [[ -n "$extracted_path" ]]; do
  relative_path="${extracted_path#"$staging_dir/"}"
  case "$relative_path" in
    ''|.|/*|../*|*/../*|*/./*)
      fail "extracted release contains an unsafe path: $relative_path"
      ;;
  esac
  if [[ -L "$extracted_path" ]]; then
    fail 'extracted release contains a symbolic link'
  fi
  if [[ ! -d "$extracted_path" && ! -f "$extracted_path" ]]; then
    fail 'extracted release contains an unsupported filesystem entry'
  fi
done < <(find "$staging_dir" -mindepth 1 -print)

find "$staging_dir" -type d -exec chmod 0755 {} +
find "$staging_dir" -type f -exec chmod 0644 {} +

if find "$shared_assets_dir" -type l -print -quit | grep -q .; then
  fail 'shared assets contain a symbolic link'
fi
find "$shared_assets_dir" -type d -exec chmod 0755 {} +
find "$shared_assets_dir" -type f -exec chmod 0644 {} +

# Check every target before publishing any new asset so a collision cannot leave a partial
# asset update behind.
while IFS= read -r asset_path || [[ -n "$asset_path" ]]; do
  relative_asset="${asset_path#"$staging_dir/assets/"}"
  target_path="$shared_assets_dir/$relative_asset"
  target_parent="$(dirname "$target_path")"

  if [[ -L "$target_parent" ]]; then
    fail "shared asset parent is a symbolic link: $relative_asset"
  fi
  if [[ -e "$target_path" || -L "$target_path" ]]; then
    if [[ -f "$target_path" && ! -L "$target_path" ]] && cmp -s "$asset_path" "$target_path"; then
      continue
    fi
    fail "asset collision: $relative_asset"
  fi
done < <(find "$staging_dir/assets" -type f -print)

while IFS= read -r asset_path || [[ -n "$asset_path" ]]; do
  relative_asset="${asset_path#"$staging_dir/assets/"}"
  target_path="$shared_assets_dir/$relative_asset"
  target_parent="$(dirname "$target_path")"

  if [[ -e "$target_path" || -L "$target_path" ]]; then
    if [[ -f "$target_path" && ! -L "$target_path" ]] && cmp -s "$asset_path" "$target_path"; then
      continue
    fi
    fail "asset appeared during publish: $relative_asset"
  fi
  mkdir -p "$target_parent"
  if [[ -L "$target_parent" ]]; then
    fail "shared asset parent is a symbolic link: $relative_asset"
  fi
  find "$target_parent" -type d -exec chmod 0755 {} +

  asset_tmp="$(mktemp "$shared_assets_dir/.mailhub-asset.XXXXXX")"
  cp "$asset_path" "$asset_tmp"
  chmod 0644 "$asset_tmp"
  if [[ -e "$target_path" || -L "$target_path" ]]; then
    if [[ -f "$target_path" && ! -L "$target_path" ]] && cmp -s "$asset_tmp" "$target_path"; then
      rm -f "$asset_tmp"
      asset_tmp=''
      continue
    fi
    fail "asset appeared during publish: $relative_asset"
  fi
  mv -f "$asset_tmp" "$target_path"
  asset_tmp=''
done < <(find "$staging_dir/assets" -type f -print)

mv "$staging_dir" "$release_dir"
staging_dir=''

current_tmp="$deploy_root/.current.${release_sha}.$$"
ln -s "$release_dir" "$current_tmp"
if mv -Tf "$current_tmp" "$current_link" 2>/dev/null; then
  current_tmp=''
else
  if ! command -v python3 >/dev/null 2>&1; then
    fail 'atomic symlink replacement requires mv -T or python3'
  fi
  python3 - "$current_tmp" "$current_link" <<'PY'
import os
import sys

os.replace(sys.argv[1], sys.argv[2])
PY
  current_tmp=''
fi

printf 'Published frontend release %s\n' "$release_sha"
