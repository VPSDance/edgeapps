# GH Proxy

GitHub proxy worker for Cloudflare Workers and EdgeOne Pages Functions.

Languages: [English](README.md) | [中文](README.zh.md)

## Structure

- Cloudflare: `src/cf/index.js`
- EdgeOne (root landing): `src/edgeone/edge-functions/index.js`
- EdgeOne (proxy): `src/edgeone/edge-functions/[[default]].js`
- Build output: `dist/cf` + `dist/eo`

## Build

```bash
cd apps/gh-proxy
pnpm install
pnpm run build
```

Outputs:
- `dist/cf/_worker.js`
- `dist/cf/favicon.ico`
- `dist/eo/edge-functions/index.js`
- `dist/eo/edge-functions/[[default]].js`
- `dist/eo/favicon.ico`

## Release (build + publish)

```bash
cp gh-proxy.env.example ./gh-proxy.env
pnpm release
```
Run from `apps/gh-proxy` (or use workspace scripts from repo root).
Edit `gh-proxy.env` with your credentials before release.

Required env (short names):
- EO_NAME, EO_TOKEN
- CF_NAME, CF_TOKEN, CF_ACCOUNT

Notes:
- This script reads `gh-proxy.env` if present (repo root or app dir), then falls back to shell env vars.
- CF_ACCOUNT is your Cloudflare Account ID (find it in the dashboard URL `/accounts/<ACCOUNT_ID>` or in Workers & Pages overview).

Release options:
- `--dry-run` (print commands, no exec; use `pnpm release -- --dry-run`)
- `--skip-build` (deploy existing dist only; use `pnpm release -- --skip-build`)
- `-o cf|eo` (publish a single target; `cf` = Cloudflare, `eo` = EdgeOne; use `pnpm release -- -o cf`)

## Config

Required:
- GH_ALLOW_RULES: allowlist (comma-separated: `owner,owner/repo,owner/gistId`; `*` allows all). Also applies to `git clone`.

Optional:
- GH_INJECT_RULES: raw targets that should auto-attach `GH_INJECT_TOKEN` (private repos); same format as GH_ALLOW_RULES; `*` = all.
- GH_INJECT_TOKEN: token auto-attached to raw requests when `GH_INJECT_RULES` matches.
- GH_API_TOKEN: token for api.github.com (reduces rate-limit/403/429).
- BASIC_AUTH_RULES: targets that require Basic auth (private access); same format as GH_ALLOW_RULES; `*` = all.
- BASIC_AUTH: Basic auth credentials in `user:pass` format for `BASIC_AUTH_RULES` (required if `BASIC_AUTH_RULES` is set).
- LANDING_HTML: override landing HTML for `/`.

KV bindings:
- GH_KV: optional allowlist storage (`allow_rules`) for large lists and auth stats/bans; recommended when Basic Auth is enabled (auto-ban brute-force).

## Examples

Basic (allow specific owners):
```bash
GH_ALLOW_RULES=owner,owner2
```

Private repo access (server attach token for raw):
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

```text
raw:
  https://<host>/raw/<owner>/<repo>/<ref>/<path>
  https://<host>/raw/<owner>/<repo>/refs/heads/<branch>/<path>
  https://<token>@<host>/raw/<owner>/<repo>/<ref>/<path>
  https://<host>/https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
api:
  https://<host>/api/repos/<owner>/<repo>/releases/latest
  https://<host>/https://api.github.com/repos/<owner>/<repo>/releases/latest
gist:
  https://<host>/gist/<owner>/<gist_id>/raw/<file>
  https://<host>/https://gist.githubusercontent.com/<owner>/<gist_id>/raw/<file>
github.com:
  https://<host>/<owner>/<repo>/raw/refs/heads/<branch>/<path>
  https://<host>/<owner>/<repo>/releases/latest
  # releases/latest returns 302 with Location rewritten to the current proxy host
  https://<host>/<owner>/<repo>/releases/download/<tag>/<file>
  https://<host>/<owner>/<repo>/archive/refs/heads/<branch>.zip
  https://<host>/<owner>/<repo>/archive/refs/tags/<tag>.tar.gz
  https://<host>/https://github.com/<owner>/<repo>/raw/refs/heads/<branch>/<path>
  https://<host>/https://github.com/<owner>/<repo>/releases/latest
  https://<host>/https://github.com/<owner>/<repo>/archive/refs/heads/<branch>.zip
  https://<host>/https://github.com/<owner>/<repo>/archive/refs/tags/<tag>.tar.gz
git:
  git clone https://<host>/<owner>/<repo>.git
  git clone https://<host>/<owner>/<repo>
  git clone https://<token>@<host>/<owner>/<repo>.git
  git clone https://<host>/https://github.com/<owner>/<repo>.git
attachments (requires GH_ALLOW_RULES includes user-attachments):
  https://<host>/user-attachments/files/<id>/<file>
  https://<host>/user-attachments/assets/<id>
  https://<host>/https://github.com/user-attachments/files/<id>/<file>
  https://<host>/https://github.com/user-attachments/assets/<id>
```

## Internal Routes

- `GET /_/status`: auth stats/ban info (requires `GH_KV` + `BASIC_AUTH`).
- `GET /_/ip`: detected client IP (EdgeOne Pages: IPv6 not supported yet).
- `GET /_/auth`: Basic auth ping for testing (requires `BASIC_AUTH`).
