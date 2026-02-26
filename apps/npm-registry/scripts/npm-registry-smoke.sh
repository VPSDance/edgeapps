#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
WORKSPACE_DIR=$(cd "$APP_DIR/../.." && pwd)
REPO_DIR=$(cd "$WORKSPACE_DIR/.." && pwd)

load_env() {
  local file="$1"
  if [ -f "$file" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$file"
    set +a
  fi
}

load_env "$REPO_DIR/npm-registry-smoke.env"
load_env "$WORKSPACE_DIR/npm-registry-smoke.env"
load_env "$APP_DIR/npm-registry-smoke.env"

PASS=0
FAIL=0
SKIP=0
if [ -t 1 ]; then
  GREEN=$'\033[32m'
  RED=$'\033[31m'
  YELLOW=$'\033[33m'
  RESET=$'\033[0m'
else
  GREEN=''
  RED=''
  YELLOW=''
  RESET=''
fi

say() {
  printf '%s\n' "$*"
}

ok() {
  PASS=$((PASS + 1))
  say "${GREEN}[OK]${RESET} $*"
}

fail() {
  FAIL=$((FAIL + 1))
  say "${RED}[FAIL]${RESET} $*"
}

skip() {
  SKIP=$((SKIP + 1))
  say "${YELLOW}[SKIP]${RESET} $*"
}

req() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    skip "missing $name"
    return 1
  fi
  return 0
}

parse_csv() {
  printf '%s' "$1" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed '/^$/d'
}

url_encode() {
  node -e 'console.log(encodeURIComponent(process.argv[1]))' "$1"
}

trim_slash() {
  local value="$1"
  printf '%s' "${value%/}"
}

http_status() {
  local url="$1"
  shift
  curl -sS -o /dev/null -w '%{http_code}' --max-time 40 "$@" "$url"
}

run_expect_status() {
  local name="$1"
  local url="$2"
  local expected="$3"
  shift 3
  local code
  if ! code=$(http_status "$url" "$@"); then
    fail "$name -> request failed ($url)"
    return
  fi
  if [ "$code" = "$expected" ]; then
    ok "$name -> $expected"
  else
    fail "$name -> expected $expected got $code ($url)"
  fi
}

run_expect_status_in() {
  local name="$1"
  local url="$2"
  local expected_csv="$3"
  shift 3
  local code
  if ! code=$(http_status "$url" "$@"); then
    fail "$name -> request failed ($url)"
    return
  fi
  local expected
  for expected in $(parse_csv "$expected_csv"); do
    if [ "$code" = "$expected" ]; then
      ok "$name -> $code"
      return
    fi
  done
  fail "$name -> expected one of [$expected_csv] got $code ($url)"
}

json_field() {
  local path="$1"
  node -e '
const fs = require("fs");
const path = process.argv[1];
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const value = path.split(".").reduce((acc, key) => acc == null ? undefined : acc[key], data);
process.stdout.write(value == null ? "" : String(value));
' "$path"
}

if [ -z "${NPM_REGISTRY_HOSTS:-}" ] && [ -z "${NPM_REGISTRY_HOST:-}" ]; then
  skip "missing NPM_REGISTRY_HOST or NPM_REGISTRY_HOSTS"
  exit 1
fi

req NPM_REGISTRY_TOKEN || exit 1
req NPM_REGISTRY_READ_TEST_PACKAGE || exit 1
req NPM_REGISTRY_WRITE_TEST_PACKAGE || exit 1

READ_TEST_PACKAGE="$(printf '%s' "${NPM_REGISTRY_READ_TEST_PACKAGE:-}" | sed 's/[[:space:]]//g')"
WRITE_TOKEN="${NPM_REGISTRY_WRITE_TOKEN:-${NPM_REGISTRY_TOKEN}}"
HOST_LIST="${NPM_REGISTRY_HOSTS:-${NPM_REGISTRY_HOST:-}}"
RW_TAG="smoke"
WRITE_TEST_PACKAGE="$(printf '%s' "${NPM_REGISTRY_WRITE_TEST_PACKAGE:-}" | sed 's/[[:space:]]//g')"

build_publish_payload() {
  local pkg_name="$1"
  local pkg_version="$2"
  local tmp_dir
  tmp_dir=$(mktemp -d)

  mkdir -p "$tmp_dir/package"
  cat > "$tmp_dir/package/package.json" <<EOF
{
  "name": "$pkg_name",
  "version": "$pkg_version",
  "description": "smoke publish payload",
  "main": "index.js"
}
EOF
  cat > "$tmp_dir/package/index.js" <<'EOF'
module.exports = "smoke";
EOF

  local base_name
  base_name=$(node -e 'const p=process.argv[1]; console.log(p.includes("/") ? p.split("/").pop() : p);' "$pkg_name")
  local attach_name="${base_name}-${pkg_version}.tgz"
  local tar_file="$tmp_dir/$attach_name"
  tar -C "$tmp_dir" -czf "$tar_file" package

  local attach_b64
  attach_b64=$(node -e 'process.stdout.write(require("fs").readFileSync(process.argv[1]).toString("base64"))' "$tar_file")
  local payload
  payload=$(node - "$pkg_name" "$pkg_version" "$attach_name" "$attach_b64" <<'NODE'
const [name, version, attachName, attachData] = process.argv.slice(2);
const payload = {
  _id: name,
  name,
  'dist-tags': { latest: version },
  versions: {
    [version]: {
      name,
      version
    }
  },
  _attachments: {
    [attachName]: {
      content_type: 'application/octet-stream',
      data: attachData,
      length: 0
    }
  }
};
process.stdout.write(JSON.stringify(payload));
NODE
)
  rm -rf "$tmp_dir"
  printf '%s' "$payload"
}

for host in $(parse_csv "$HOST_LIST"); do
  HOST=$(trim_slash "$host")
  say "npm-registry smoke test -> $HOST"

  AUTH_HEADER="authorization: Bearer ${NPM_REGISTRY_TOKEN}"

  run_expect_status "landing" "$HOST/" 200
  run_expect_status "status" "$HOST/_/status" 200 -H "$AUTH_HEADER"
  run_expect_status "ping" "$HOST/-/ping" 200 -H "$AUTH_HEADER"
  run_expect_status "whoami" "$HOST/-/whoami" 200 -H "$AUTH_HEADER"

  AUDIT_BULK_URL="$HOST/-/npm/v1/security/advisories/bulk"
  AUDIT_QUICK_URL="$HOST/-/npm/v1/security/audits/quick"
  AUDIT_BULK_PAYLOAD='{"lodash":["4.17.21"]}'
  AUDIT_QUICK_PAYLOAD='{"name":"smoke-audit","version":"1.0.0","requires":true,"dependencies":{"lodash":{"version":"4.17.21"}}}'

  run_expect_status "audit bulk unauthorized" "$AUDIT_BULK_URL" 401 -X POST -H 'content-type: application/json' --data "$AUDIT_BULK_PAYLOAD"
  run_expect_status "audit quick unauthorized" "$AUDIT_QUICK_URL" 401 -X POST -H 'content-type: application/json' --data "$AUDIT_QUICK_PAYLOAD"
  run_expect_status_in "audit bulk passthrough" "$AUDIT_BULK_URL" "200,400" -X POST -H "$AUTH_HEADER" -H 'content-type: application/json' --data "$AUDIT_BULK_PAYLOAD"
  run_expect_status_in "audit quick passthrough" "$AUDIT_QUICK_URL" "200,400" -X POST -H "$AUTH_HEADER" -H 'content-type: application/json' --data "$AUDIT_QUICK_PAYLOAD"

  ENCODED_PKG=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$READ_TEST_PACKAGE")
  META_URL="$HOST/$ENCODED_PKG"

  META_JSON=$(curl -fsSL --max-time 40 -H "$AUTH_HEADER" "$META_URL") || {
    fail "metadata fetch failed ($META_URL)"
    continue
  }
  ok "metadata fetch -> $READ_TEST_PACKAGE"

  LATEST=$(printf '%s' "$META_JSON" | json_field 'dist-tags.latest')
  if [ -z "$LATEST" ]; then
    fail "metadata latest missing -> $READ_TEST_PACKAGE"
    continue
  fi
  ok "metadata latest -> $LATEST"

  META_TARBALL=$(printf '%s' "$META_JSON" | node -e '
const fs = require("fs");
const meta = JSON.parse(fs.readFileSync(0, "utf8"));
const latest = String(meta?.["dist-tags"]?.latest || "");
const tarball = latest && meta?.versions?.[latest]?.dist?.tarball
  ? String(meta.versions[latest].dist.tarball)
  : "";
process.stdout.write(tarball);
')
  if [[ "$META_TARBALL" == "$HOST/"* ]]; then
    ok "metadata tarball rewritten -> local registry"
  else
    fail "metadata tarball is not local registry ($META_TARBALL)"
  fi

  PKG_BASE=$(node -e 'const p=process.argv[1]; console.log(p.includes("/") ? p.split("/").pop() : p);' "$READ_TEST_PACKAGE")
  CANONICAL_TGZ_URL="$HOST/$READ_TEST_PACKAGE/-/${PKG_BASE}-${LATEST}.tgz"

  run_expect_status "canonical tarball status" "$CANONICAL_TGZ_URL" 200 -H "$AUTH_HEADER"

  TGZ_CT=$(curl -sSIL --max-time 40 -H "$AUTH_HEADER" "$CANONICAL_TGZ_URL" | tr -d '\r' | awk 'tolower($1)=="content-type:"{v=tolower($2)} END{print v}')
  if [[ "$TGZ_CT" == *"json"* ]]; then
    fail "canonical tarball content-type looks wrong ($TGZ_CT)"
  else
    ok "canonical tarball content-type -> ${TGZ_CT:-unknown}"
  fi

  if [ -n "${NPM_REGISTRY_ADMIN_BASIC:-}" ]; then
    run_expect_status "admin whoami (basic)" "$HOST/_/api/admin/whoami" 200 -u "$NPM_REGISTRY_ADMIN_BASIC"
  else
    skip "admin basic test (missing NPM_REGISTRY_ADMIN_BASIC)"
  fi

  RW_AUTH_HEADER="authorization: Bearer ${WRITE_TOKEN}"
  RW_VERSION="0.0.0-smoke.$(date +%s)"
  RW_ENCODED=$(url_encode "$WRITE_TEST_PACKAGE")
  DIST_LIST_URL="$HOST/-/package/$RW_ENCODED/dist-tags"
  DIST_TAG_URL="$DIST_LIST_URL/$RW_TAG"

  PUBLISH_URL="$HOST/$RW_ENCODED"
  PAYLOAD=$(build_publish_payload "$WRITE_TEST_PACKAGE" "$RW_VERSION")
  PUB_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 40 -X PUT -H "$RW_AUTH_HEADER" -H 'content-type: application/json' --data "$PAYLOAD" "$PUBLISH_URL") || PUB_CODE="000"
  if [ "$PUB_CODE" = "201" ]; then
    ok "auto publish -> $WRITE_TEST_PACKAGE@$RW_VERSION"
  else
    if [ "$PUB_CODE" = "401" ] || [ "$PUB_CODE" = "403" ]; then
      fail "auto publish unauthorized -> status $PUB_CODE ($WRITE_TEST_PACKAGE@$RW_VERSION), check token write ACL and NPM_REGISTRY_WRITE_TEST_PACKAGE"
    else
      fail "auto publish failed -> status $PUB_CODE ($WRITE_TEST_PACKAGE@$RW_VERSION)"
    fi
    continue
  fi

  run_expect_status "dist-tag list before" "$DIST_LIST_URL" 200 -H "$RW_AUTH_HEADER"

  ADD_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 40 -X PUT -H "$RW_AUTH_HEADER" -H 'content-type: application/json' --data "\"$RW_VERSION\"" "$DIST_TAG_URL") || ADD_CODE="000"
  if [ "$ADD_CODE" = "200" ] || [ "$ADD_CODE" = "201" ]; then
    ok "dist-tag add -> $RW_TAG=$RW_VERSION"
  else
    fail "dist-tag add failed -> status $ADD_CODE"
  fi

  TAG_JSON=$(curl -fsSL --max-time 40 -H "$RW_AUTH_HEADER" "$DIST_LIST_URL") || TAG_JSON='{}'
  TAG_VALUE=$(printf '%s' "$TAG_JSON" | json_field "$RW_TAG")
  if [ "$TAG_VALUE" = "$RW_VERSION" ]; then
    ok "dist-tag verify -> $RW_TAG=$TAG_VALUE"
  else
    fail "dist-tag verify failed -> expected $RW_VERSION got ${TAG_VALUE:-<empty>}"
  fi

  DEL_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 40 -X DELETE -H "$RW_AUTH_HEADER" "$DIST_TAG_URL") || DEL_CODE="000"
  if [ "$DEL_CODE" = "200" ] || [ "$DEL_CODE" = "204" ]; then
    ok "dist-tag delete -> $RW_TAG"
  else
    fail "dist-tag delete failed -> status $DEL_CODE"
  fi

  SEMVER_MAJOR="$(date +%s)"
  SEMVER_STABLE="${SEMVER_MAJOR}.0.0"
  SEMVER_BETA="${SEMVER_STABLE}-beta.1"

  SEMVER_PAYLOAD_STABLE=$(build_publish_payload "$WRITE_TEST_PACKAGE" "$SEMVER_STABLE")
  SEMVER_PUB_STABLE_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 40 -X PUT -H "$RW_AUTH_HEADER" -H 'content-type: application/json' --data "$SEMVER_PAYLOAD_STABLE" "$PUBLISH_URL") || SEMVER_PUB_STABLE_CODE="000"
  if [ "$SEMVER_PUB_STABLE_CODE" = "201" ]; then
    ok "semver publish stable -> $WRITE_TEST_PACKAGE@$SEMVER_STABLE"
  else
    fail "semver publish stable failed -> status $SEMVER_PUB_STABLE_CODE ($WRITE_TEST_PACKAGE@$SEMVER_STABLE)"
  fi

  SEMVER_PAYLOAD_BETA=$(build_publish_payload "$WRITE_TEST_PACKAGE" "$SEMVER_BETA")
  SEMVER_PUB_BETA_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 40 -X PUT -H "$RW_AUTH_HEADER" -H 'content-type: application/json' --data "$SEMVER_PAYLOAD_BETA" "$PUBLISH_URL") || SEMVER_PUB_BETA_CODE="000"
  if [ "$SEMVER_PUB_BETA_CODE" = "201" ]; then
    ok "semver publish prerelease -> $WRITE_TEST_PACKAGE@$SEMVER_BETA"
  else
    fail "semver publish prerelease failed -> status $SEMVER_PUB_BETA_CODE ($WRITE_TEST_PACKAGE@$SEMVER_BETA)"
  fi

  DIST_TAG_LATEST_URL="$DIST_LIST_URL/latest"
  DEL_LATEST_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 40 -X DELETE -H "$RW_AUTH_HEADER" "$DIST_TAG_LATEST_URL") || DEL_LATEST_CODE="000"
  if [ "$DEL_LATEST_CODE" = "200" ] || [ "$DEL_LATEST_CODE" = "204" ]; then
    ok "dist-tag delete -> latest"
  else
    fail "dist-tag delete latest failed -> status $DEL_LATEST_CODE"
  fi

  SEMVER_TAG_JSON=$(curl -fsSL --max-time 40 -H "$RW_AUTH_HEADER" "$DIST_LIST_URL") || SEMVER_TAG_JSON='{}'
  SEMVER_LATEST_AFTER=$(printf '%s' "$SEMVER_TAG_JSON" | json_field 'latest')
  if [ "$SEMVER_LATEST_AFTER" = "$SEMVER_STABLE" ]; then
    ok "semver latest fallback -> $SEMVER_LATEST_AFTER"
  else
    fail "semver latest fallback failed -> expected $SEMVER_STABLE got ${SEMVER_LATEST_AFTER:-<empty>}"
  fi

  META_WRITE_URL="$HOST/$RW_ENCODED?write=true"
  META_JSON=$(curl -fsSL --max-time 40 -H "$RW_AUTH_HEADER" "$META_WRITE_URL") || META_JSON='{}'
  REV=$(printf '%s' "$META_JSON" | json_field '_rev')
  if [ -n "$REV" ]; then
    REV_ENCODED=$(url_encode "$REV")
    PKG_REV_URL="$HOST/$RW_ENCODED/-rev/$REV_ENCODED"
    UNPUBLISH_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 40 -X DELETE -H "$RW_AUTH_HEADER" "$PKG_REV_URL") || UNPUBLISH_CODE="000"
    if [ "$UNPUBLISH_CODE" = "200" ] || [ "$UNPUBLISH_CODE" = "204" ]; then
      ok "auto cleanup package -> $WRITE_TEST_PACKAGE"
    else
      fail "auto cleanup package failed -> status $UNPUBLISH_CODE ($WRITE_TEST_PACKAGE)"
    fi
  else
    fail "auto cleanup skipped: missing _rev ($WRITE_TEST_PACKAGE)"
  fi

done

if [ "$FAIL" -gt 0 ]; then
  say "${RED}Summary: $PASS ok, $FAIL fail, $SKIP skip${RESET}"
else
  say "${GREEN}Summary: $PASS ok, $FAIL fail, $SKIP skip${RESET}"
fi
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
