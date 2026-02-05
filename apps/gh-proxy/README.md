# GH Proxy

GitHub proxy worker for Cloudflare Workers and EdgeOne Pages Functions.

Languages: [English](README.md) | [中文](README.zh.md)

## Structure

- Cloudflare: `src/cf/index.js`
- EdgeOne (root landing): `src/edgeone/edge-functions/index.js`
- EdgeOne (proxy): `src/edgeone/edge-functions/[[default]].js`
- Build output: `dist/` (mirrors `src/` layout)

## Build

```bash
cd apps/gh-proxy
pnpm install
pnpm run build
```

Outputs:
- `dist/cf/index.js`
- `dist/edgeone/edge-functions/index.js`
- `dist/edgeone/edge-functions/[[default]].js`

## Release (build + publish)

```bash
pnpm run release
```
Run from `apps/gh-proxy` (or use workspace scripts from repo root).

Required env (short names):
- EO_NAME, EO_TOKEN
- CF_NAME, CF_TOKEN, CF_ACCOUNT

Notes:
- This script reads `gh-proxy.env` if present (repo root or app dir), then falls back to shell env vars.
- Cloudflare deploy uses the Script Upload API (keeps Dashboard bindings).
- CF_ACCOUNT is your Cloudflare Account ID (find it in the dashboard URL `/accounts/<ACCOUNT_ID>` or in Workers & Pages overview).

Example:

```bash
EO_NAME=ghproxy EO_TOKEN=... CF_NAME=ghproxy CF_TOKEN=... CF_ACCOUNT=... pnpm run release
```

Release options:
- `--dry-run` (print commands, no exec; use `pnpm run release -- --dry-run`)
- `-o cf|eo` (publish a single target; use `pnpm run release -- -o cf`)

## Config

Required:
- GH_ALLOW_RULES: allowlist (comma-separated: `owner,owner/repo,owner/gistId`; `*` allows all). Also applies to `git clone`.

Optional:
- GH_INJECT_RULES: raw targets for token injection (same format as GH_ALLOW_RULES; `*` = all).
- GH_INJECT_TOKEN: token used when `GH_INJECT_RULES` matches.
- GH_API_TOKEN: token for api.github.com (reduces rate-limit/403/429).
- BASIC_AUTH_RULES: targets that require Basic auth (same format as GH_ALLOW_RULES; `*` = all).
- BASIC_AUTH: Basic auth in `user:pass` form (required if `BASIC_AUTH_RULES` is set).
- LANDING_HTML: override landing HTML for `/`.

KV bindings:
- GH_KV: optional allowlist storage (`allow_rules`) for large lists and auth stats/bans.

## Examples

Basic (allow specific owners):
```bash
GH_ALLOW_RULES=owner,owner2
```

Private repo access (server inject for raw):
```bash
GH_ALLOW_RULES=owner/private-repo
GH_INJECT_RULES=owner/private-repo
GH_INJECT_TOKEN=ghp_xxx
```

Basic auth gate (protect selected targets):
```bash
GH_ALLOW_RULES=owner
BASIC_AUTH_RULES=owner/private-repo
BASIC_AUTH=user:pass
```
Optional: set `GH_KV` to enable `/_/status` and auth failure tracking + bans (default: 5 fails/15 min → 24-hour ban).

## GH Proxy usage (EdgeOne/CF)

- raw:
  https://<host>/raw/<owner>/<repo>/<ref>/<path>
  https://<host>/raw/<owner>/<repo>/refs/heads/<branch>/<path>
  https://<token>@<host>/raw/<owner>/<repo>/<ref>/<path>
  https://<host>/https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
- api:
  https://<host>/api/repos/<owner>/<repo>/releases/latest
  https://<host>/https://api.github.com/repos/<owner>/<repo>/releases/latest
- gist:
  https://<host>/gist/<owner>/<gist_id>/raw/<file>
  https://<host>/https://gist.githubusercontent.com/<owner>/<gist_id>/raw/<file>
- github.com:
  https://<host>/<owner>/<repo>/raw/refs/heads/<branch>/<path>
  https://<host>/<owner>/<repo>/releases/download/<tag>/<file>
  https://<host>/<owner>/<repo>/archive/refs/heads/<branch>.zip
  https://<host>/<owner>/<repo>/archive/refs/tags/<tag>.tar.gz
  https://<host>/https://github.com/<owner>/<repo>/raw/refs/heads/<branch>/<path>
  https://<host>/https://github.com/<owner>/<repo>/archive/refs/heads/<branch>.zip
  https://<host>/https://github.com/<owner>/<repo>/archive/refs/tags/<tag>.tar.gz

- git:
  git clone https://<host>/<owner>/<repo>.git
  git clone https://<host>/<owner>/<repo>
  git clone https://<token>@<host>/<owner>/<repo>.git
  git clone https://<host>/https://github.com/<owner>/<repo>.git

- attachments:
  https://<host>/user-attachments/files/<id>/<file>
  https://<host>/user-attachments/assets/<id>
  https://<host>/https://github.com/user-attachments/files/<id>/<file>
  https://<host>/https://github.com/user-attachments/assets/<id>
  Note: add `user-attachments` (or `user-attachments/files`, `user-attachments/assets`) to `GH_ALLOW_RULES`.

## Utility

- `GET /_/status`: auth stats/ban info (requires `GH_KV` + `BASIC_AUTH`).
- `GET /_/ip`: detected client IP (EdgeOne Pages: IPv6 not supported yet).
- `GET /_/auth`: Basic auth ping for testing (requires `BASIC_AUTH`).
