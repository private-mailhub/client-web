#!/usr/bin/env bash
set -eu

assert_other_execute() {
  python3 - "$1" <<'PY'
import os
import sys

sys.exit(0 if os.stat(sys.argv[1]).st_mode & 1 else 1)
PY
}

assert_other_read() {
  python3 - "$1" <<'PY'
import os
import sys

sys.exit(0 if os.stat(sys.argv[1]).st_mode & 4 else 1)
PY
}

assert_mode_755() {
  python3 - "$1" <<'PY'
import os
import sys

sys.exit(0 if os.stat(sys.argv[1]).st_mode & 0o777 == 0o755 else 1)
PY
}

assert_mode_644() {
  python3 - "$1" <<'PY'
import os
import sys

sys.exit(0 if os.stat(sys.argv[1]).st_mode & 0o777 == 0o644 else 1)
PY
}

repo_root=$(cd "$(dirname "$0")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

deploy_root="$test_root/frontend"
archive_root="$test_root/archive"
changed_archive_root="$test_root/changed-archive"
collision_archive_root="$test_root/collision-archive"
stub_bin="$test_root/bin"
mkdir -p "$deploy_root/shared/assets" "$deploy_root/releases" "$archive_root/dist/assets" "$stub_bin"
mkdir -p "$changed_archive_root/dist/assets"
mkdir -p "$collision_archive_root/dist/assets"
printf 'legacy asset\n' > "$deploy_root/shared/assets/legacy.js"
chmod 0600 "$deploy_root/shared/assets/legacy.js"
printf '<!doctype html><script src="/assets/new-asset.js"></script>\n' > "$archive_root/dist/index.html"
printf 'new asset\n' > "$archive_root/dist/assets/new-asset.js"
mkdir -p "$archive_root/dist/assets/chunks"
printf 'new nested asset\n' > "$archive_root/dist/assets/chunks/new-chunk.js"
printf 'User-agent: *\nDisallow:\n' > "$archive_root/dist/robots.txt"
printf 'favicon\n' > "$archive_root/dist/favicon.ico"
tar -czf "$test_root/frontend.tar.gz" -C "$archive_root" dist
printf '<!doctype html><script src="/assets/new-asset.js"></script>\n' > "$changed_archive_root/dist/index.html"
cp "$archive_root/dist/assets/new-asset.js" "$changed_archive_root/dist/assets/new-asset.js"
printf 'next asset\n' > "$changed_archive_root/dist/assets/next-asset.js"
tar -czf "$test_root/frontend-changed.tar.gz" -C "$changed_archive_root" dist
cp -R "$archive_root/dist/." "$collision_archive_root/dist/"
printf 'changed asset\n' > "$collision_archive_root/dist/assets/new-asset.js"
tar -czf "$test_root/frontend-collision.tar.gz" -C "$collision_archive_root" dist

cat > "$stub_bin/pm2" <<'EOF'
#!/usr/bin/env bash
printf 'pm2 must not be called\n' >&2
exit 99
EOF
chmod +x "$stub_bin/pm2"
if ! command -v flock >/dev/null 2>&1; then
cat > "$stub_bin/flock" <<'EOF'
#!/usr/bin/env python3
import fcntl
import subprocess
import sys

args = sys.argv[1:]
while args and args[0] in ('-x', '-n', '-w'):
    args.pop(0)
if args and args[0].isdigit():
    fcntl.flock(int(args[0]), fcntl.LOCK_EX)
    raise SystemExit(0)
if len(args) >= 3 and args[1] == '-c':
    with open(args[0], 'a+') as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        raise SystemExit(subprocess.call(['/bin/sh', '-c', args[2]]))
raise SystemExit('test flock shim supports flock [-x|-n] FD or flock LOCK_PATH -c COMMAND')
EOF
chmod +x "$stub_bin/flock"
fi
export PATH="$stub_bin:$PATH"
export MAILHUB_DEPLOY_ROOT="$deploy_root"
export MAILHUB_DEPLOY_LOCK="$test_root/deploy.lock"

sha=abcdef0123456789abcdef0123456789abcdef01
script="$repo_root/deploy/release.sh"
if [ ! -x "$script" ]; then
  printf 'FAIL: expected executable %s\n' "$script" >&2
  exit 1
fi

if ! (umask 077; "$script" "$sha" "$test_root/frontend.tar.gz"); then
  printf 'FAIL: valid frontend release was not published\n' >&2
  exit 1
fi

release="$deploy_root/releases/$sha"
[ -L "$deploy_root/current" ] || { printf 'FAIL: current is not a symlink\n' >&2; exit 1; }
[ "$(readlink "$deploy_root/current")" = "$release" ] || {
  printf 'FAIL: current does not resolve to the requested SHA release\n' >&2
  exit 1
}
[ -f "$release/index.html" ] || { printf 'FAIL: index.html missing\n' >&2; exit 1; }
[ -f "$release/assets/new-asset.js" ] || { printf 'FAIL: hashed asset missing from release\n' >&2; exit 1; }
[ -f "$release/assets/chunks/new-chunk.js" ] || {
  printf 'FAIL: nested hashed asset missing from release\n' >&2
  exit 1
}
[ -f "$release/robots.txt" ] || { printf 'FAIL: robots.txt missing from release\n' >&2; exit 1; }
[ -f "$release/favicon.ico" ] || { printf 'FAIL: favicon.ico missing from release\n' >&2; exit 1; }
assert_mode_755 "$release" || {
  printf 'FAIL: published release root is not traversable\n' >&2
  exit 1
}
while IFS= read -r directory; do
  assert_mode_755 "$directory" || {
    printf 'FAIL: published directory is not traversable: %s\n' "$directory" >&2
    exit 1
  }
done < <(find "$release" -type d -print)
assert_mode_755 "$deploy_root/shared/assets" || {
  printf 'FAIL: shared asset directory is not mode 0755\n' >&2
  exit 1
}
assert_mode_755 "$deploy_root/shared/assets/chunks" || {
  printf 'FAIL: nested shared asset directory is not mode 0755\n' >&2
  exit 1
}
while IFS= read -r file; do
  assert_other_read "$file" || {
    printf 'FAIL: published file is not readable: %s\n' "$file" >&2
    exit 1
  }
done < <(find "$release" -type f -print)
[ -f "$deploy_root/shared/assets/legacy.js" ] || {
  printf 'FAIL: existing shared asset was overwritten or removed\n' >&2
  exit 1
}
assert_mode_644 "$deploy_root/shared/assets/legacy.js" || {
  printf 'FAIL: existing shared asset was not normalized to mode 0644\n' >&2
  exit 1
}
[ -f "$deploy_root/shared/assets/new-asset.js" ] || {
  printf 'FAIL: new asset was not append-only published to shared assets\n' >&2
  exit 1
}
[ -f "$deploy_root/shared/assets/chunks/new-chunk.js" ] || {
  printf 'FAIL: nested asset was not published to shared assets\n' >&2
  exit 1
}
assert_other_read "$deploy_root/shared/assets/new-asset.js" || {
  printf 'FAIL: published shared asset is not mode 0644\n' >&2
  exit 1
}

if "$script" "$sha" "$test_root/frontend.tar.gz" >/dev/null 2>&1; then
  printf 'FAIL: existing release was overwritten on repeat\n' >&2
  exit 1
fi

next_sha=1234567890abcdef1234567890abcdef12345678
if ! "$script" "$next_sha" "$test_root/frontend-changed.tar.gz" >/dev/null 2>&1; then
  printf 'FAIL: unchanged asset reuse with a new asset was rejected\n' >&2
  exit 1
fi
[ "$(readlink "$deploy_root/current")" = "$deploy_root/releases/$next_sha" ] || {
  printf 'FAIL: next release did not become current\n' >&2
  exit 1
}
[ -f "$deploy_root/shared/assets/next-asset.js" ] || {
  printf 'FAIL: next release asset was not published\n' >&2
  exit 1
}

collision_sha=234567890abcdef1234567890abcdef123456789
if "$script" "$collision_sha" "$test_root/frontend-collision.tar.gz" >/dev/null 2>&1; then
  printf 'FAIL: changed content reused an existing asset name\n' >&2
  exit 1
fi
[ "$(readlink "$deploy_root/current")" = "$deploy_root/releases/$next_sha" ] || {
  printf 'FAIL: rejected asset changed current release\n' >&2
  exit 1
}
[ "$(cat "$deploy_root/shared/assets/new-asset.js")" = 'new asset' ] || {
  printf 'FAIL: rejected asset changed existing shared content\n' >&2
  exit 1
}

printf 'PASS: frontend immutable release, atomic current link, required files, asset preservation, and PM2 isolation\n'
