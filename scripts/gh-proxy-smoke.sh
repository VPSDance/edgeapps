#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PARENT=$(cd "$ROOT/.." && pwd)

load_env() {
  local file="$1"
  if [ -f "$file" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$file"
    set +a
  fi
}

load_env "$PARENT/gh-proxy-smoke.env"
load_env "$ROOT/gh-proxy-smoke.env"

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

mask() {
  local value="$1"
  if [ -n "${GH_PROXY_TOKEN:-}" ]; then
    value="${value//${GH_PROXY_TOKEN}/***}"
  fi
  printf '%s' "$value"
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

run_curl() {
  local name="$1"
  local url="$2"
  shift 2
  local masked
  masked=$(mask "$url")
  if curl -fsSLI --max-time 30 "$@" "$url" >/dev/null; then
    ok "$name -> $masked"
  else
    fail "$name -> $masked"
  fi
}

run_curl_location_contains() {
  local name="$1"
  local url="$2"
  local expected="$3"
  local masked
  masked=$(mask "$url")
  local headers
  if ! headers=$(curl -sSI --max-time 30 "$url" | tr -d '\r'); then
    fail "$name -> $masked (request failed)"
    return
  fi
  local location
  location=$(printf '%s\n' "$headers" | awk 'tolower($0) ~ /^location:[[:space:]]*/ {sub(/^[^:]+:[[:space:]]*/, ""); print; exit}')
  if [ -n "$location" ] && [[ "$location" == *"$expected"* ]]; then
    ok "$name -> $masked"
  else
    fail "$name -> $masked (location=${location:-none})"
  fi
}

run_git_clone() {
  local name="$1"
  local url="$2"
  local masked
  masked=$(mask "$url")
  local tmp
  tmp=$(mktemp -d)
  if GIT_TERMINAL_PROMPT=0 git clone --quiet "$url" "$tmp/repo"; then
    ok "$name -> $masked"
  else
    fail "$name -> $masked"
  fi
  rm -rf "$tmp"
}

parse_csv() {
  printf '%s' "$1" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed '/^$/d'
}

# Required
if [ -z "${GH_PROXY_HOSTS:-}" ] && [ -z "${GH_PROXY_HOST:-}" ]; then
  skip "missing GH_PROXY_HOST or GH_PROXY_HOSTS"
  exit 1
fi
req GH_PROXY_PUBLIC_OWNER || exit 1
req GH_PROXY_PUBLIC_REPO || exit 1
req GH_PROXY_GIST_OWNER || exit 1
req GH_PROXY_GIST_ID || exit 1
req GH_PROXY_PUBLIC_TAG || exit 1
req GH_PROXY_PUBLIC_RELEASE_FILE || exit 1
req GH_PROXY_UA_FILE_ID || exit 1
req GH_PROXY_UA_FILE_NAME || exit 1
req GH_PROXY_UA_ASSET_ID || exit 1

PUB_OWNER="$GH_PROXY_PUBLIC_OWNER"
PUB_REPO="$GH_PROXY_PUBLIC_REPO"
PUB_REF="${GH_PROXY_PUBLIC_REF:-main}"
PUB_PATH="${GH_PROXY_PUBLIC_PATH:-scripts/install.sh}"
PUB_TAG="$GH_PROXY_PUBLIC_TAG"
PUB_RELEASE_FILE="$GH_PROXY_PUBLIC_RELEASE_FILE"

PRIV_OWNER="${GH_PROXY_PRIVATE_OWNER:-}"
PRIV_REPO="${GH_PROXY_PRIVATE_REPO:-}"
PRIV_REF="${GH_PROXY_PRIVATE_REF:-main}"
PRIV_PATH="${GH_PROXY_PRIVATE_PATH:-README.md}"

GIST_OWNER="$GH_PROXY_GIST_OWNER"
GIST_ID="$GH_PROXY_GIST_ID"
GIST_FILE="${GH_PROXY_GIST_FILE:-}"

UA_FILE_ID="$GH_PROXY_UA_FILE_ID"
UA_FILE_NAME="$GH_PROXY_UA_FILE_NAME"
UA_ASSET_ID="$GH_PROXY_UA_ASSET_ID"

HOST_LIST="${GH_PROXY_HOSTS:-${GH_PROXY_HOST:-}}"

for host in $(parse_csv "$HOST_LIST"); do
  HOST="$host"
  HOST_NOPROTO=${HOST#https://}
  HOST_NOPROTO=${HOST_NOPROTO#http://}

  say "GH Proxy smoke test -> $HOST"

  run_curl "raw" "$HOST/raw/$PUB_OWNER/$PUB_REPO/$PUB_REF/$PUB_PATH"
  run_curl "raw (refs)" "$HOST/raw/$PUB_OWNER/$PUB_REPO/refs/heads/$PUB_REF/$PUB_PATH"
  run_curl "api" "$HOST/api/repos/$PUB_OWNER/$PUB_REPO/releases/latest"
  run_curl "github raw" "$HOST/$PUB_OWNER/$PUB_REPO/raw/refs/heads/$PUB_REF/$PUB_PATH"
  run_curl "github release latest" "$HOST/$PUB_OWNER/$PUB_REPO/releases/latest"
  run_curl_location_contains \
    "github release latest location rewrite" \
    "$HOST/$PUB_OWNER/$PUB_REPO/releases/latest" \
    "$HOST/$PUB_OWNER/$PUB_REPO/releases/tag/"
  run_curl "github archive" "$HOST/$PUB_OWNER/$PUB_REPO/archive/refs/heads/$PUB_REF.zip"
  if [ -n "$PUB_TAG" ]; then
    run_curl "github archive tag" "$HOST/$PUB_OWNER/$PUB_REPO/archive/refs/tags/$PUB_TAG.tar.gz"
    if [ -n "$PUB_RELEASE_FILE" ]; then
      run_curl "github release" "$HOST/$PUB_OWNER/$PUB_REPO/releases/download/$PUB_TAG/$PUB_RELEASE_FILE"
    fi
  fi
  run_curl "github user-attachments file" "$HOST/user-attachments/files/$UA_FILE_ID/$UA_FILE_NAME"
  run_curl "github user-attachments asset" "$HOST/user-attachments/assets/$UA_ASSET_ID"
  run_curl "full raw" "$HOST/https://raw.githubusercontent.com/$PUB_OWNER/$PUB_REPO/$PUB_REF/$PUB_PATH"
  run_curl "full api" "$HOST/https://api.github.com/repos/$PUB_OWNER/$PUB_REPO/releases/latest"
  run_curl "full github" "$HOST/https://github.com/$PUB_OWNER/$PUB_REPO/raw/refs/heads/$PUB_REF/$PUB_PATH"
  run_curl "full github release latest" "$HOST/https://github.com/$PUB_OWNER/$PUB_REPO/releases/latest"
  run_curl_location_contains \
    "full github release latest location rewrite" \
    "$HOST/https://github.com/$PUB_OWNER/$PUB_REPO/releases/latest" \
    "$HOST/$PUB_OWNER/$PUB_REPO/releases/tag/"
  run_curl "full github archive" "$HOST/https://github.com/$PUB_OWNER/$PUB_REPO/archive/refs/heads/$PUB_REF.zip"
  if [ -n "$PUB_TAG" ]; then
    run_curl "full github archive tag" "$HOST/https://github.com/$PUB_OWNER/$PUB_REPO/archive/refs/tags/$PUB_TAG.tar.gz"
    if [ -n "$PUB_RELEASE_FILE" ]; then
      run_curl "full github release" "$HOST/https://github.com/$PUB_OWNER/$PUB_REPO/releases/download/$PUB_TAG/$PUB_RELEASE_FILE"
    fi
  fi
  run_curl "full github user-attachments file" "$HOST/https://github.com/user-attachments/files/$UA_FILE_ID/$UA_FILE_NAME"
  run_curl "full github user-attachments asset" "$HOST/https://github.com/user-attachments/assets/$UA_ASSET_ID"

  if [ -n "$GIST_FILE" ]; then
    run_curl "gist" "$HOST/gist/$GIST_OWNER/$GIST_ID/raw/$GIST_FILE"
    run_curl "full gist" "$HOST/https://gist.githubusercontent.com/$GIST_OWNER/$GIST_ID/raw/$GIST_FILE"
  else
    run_curl "gist" "$HOST/gist/$GIST_OWNER/$GIST_ID/raw"
    run_curl "full gist" "$HOST/https://gist.githubusercontent.com/$GIST_OWNER/$GIST_ID/raw"
  fi

  if [ -n "${GH_PROXY_BASIC:-}" ]; then
    run_curl "basic auth" "$HOST/_/auth" -u "$GH_PROXY_BASIC"
  else
    skip "basic auth (missing GH_PROXY_BASIC)"
  fi

  if [ -n "${GH_PROXY_TOKEN:-}" ] && [ -n "$PRIV_OWNER" ] && [ -n "$PRIV_REPO" ]; then
    run_curl "raw private (token)" "https://$GH_PROXY_TOKEN@$HOST_NOPROTO/raw/$PRIV_OWNER/$PRIV_REPO/$PRIV_REF/$PRIV_PATH"
    run_git_clone "git clone private (token)" "https://$GH_PROXY_TOKEN@$HOST_NOPROTO/$PRIV_OWNER/$PRIV_REPO.git"
  else
    skip "private token tests (missing GH_PROXY_TOKEN/GH_PROXY_PRIVATE_OWNER/GH_PROXY_PRIVATE_REPO)"
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
