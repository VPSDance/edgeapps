# GH Proxy

GitHub proxy worker for Cloudflare Workers and EdgeOne Pages Functions.
This app lives inside the Edgeapps monorepo.

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
- This script reads `.env` if present, then falls back to shell env vars.
- Cloudflare deploy uses `wrangler.toml` (copy from `wrangler.toml.example`) and keeps Dashboard vars (`--keep-vars`).
- Routes/custom domains are managed in the Cloudflare Dashboard (no routes in `wrangler.toml`).
- CF_ACCOUNT is your Cloudflare Account ID (find it in the dashboard URL `/accounts/<ACCOUNT_ID>` or in Workers & Pages overview).

Examples:

```bash
APP_NAME=ghproxy EO_TOKEN=... CF_TOKEN=... CF_ACCOUNT=... npm run deploy
```

Release options:
- `--dry-run` (print commands, no exec; use `npm run release -- --dry-run`)
- `-o cf|eo` (publish a single target; use `npm run release -- -o cf`)

## Quick Start

Minimal env:
- GH_ALLOW_RULES (comma-separated allowlist; e.g. `owner,owner/repo`)

Optional env:
- GH_INJECT_TOKEN (used only when GH_INJECT_RULES matches)
- GH_API_TOKEN
- GH_INJECT_RULES (comma-separated; e.g. `owner,owner/repo,owner/gistId`)

Example:
```bash
GH_ALLOW_RULES=owner,owner/repo,owner2
GH_INJECT_TOKEN=ghp_xxx
GH_API_TOKEN=ghp_yyy
GH_INJECT_RULES=owner,owner/repo,owner/gistId,owner2/gistId2
```

## Proxy config (Cloudflare/EdgeOne)

Env vars:
- GH_INJECT_TOKEN: optional GitHub token for raw.githubusercontent.com and gist
- GH_API_TOKEN: optional GitHub token for api.github.com
- GH_INJECT_RULES: targets that auto-inject `GH_INJECT_TOKEN` (same format as GH_ALLOW_RULES)
- GH_ALLOW_RULES: allowlist (comma-separated; e.g. `owner,owner/repo,owner/gistId`)
- BASIC_AUTH: Basic auth in `user:pass` form (used for protected paths)
- LANDING_HTML: optional HTML string for `/` (default `<a></a>`)

KV bindings:
- GH_ALLOW_RULES_KV: allowlist storage (key: `allow`, value same format as GH_ALLOW_RULES)
- AUTH_STATS: auth stats/ban

Notes:
- GH_ALLOW_RULES is case-sensitive; env size ~5 KB (few hundred owners; use GH_ALLOW_RULES_KV for large lists).
- `git clone` is still restricted by `GH_ALLOW_RULES`.

Behavior:
- `GH_INJECT_RULES` uses the same target format as `GH_ALLOW_RULES`.
- If `GH_INJECT_RULES` matches, raw requests use `GH_INJECT_TOKEN`.
- Gist requests use `GH_INJECT_TOKEN` only when `GH_INJECT_RULES` matches.
- API requests use `GH_API_TOKEN`.
- `git clone` never uses env tokens (only client `Authorization` or `token@` in URL).
- Incoming `Authorization` header always wins over injected token.

## GH Proxy usage (EdgeOne/CF)

- raw:
  https://<host>/raw/<owner>/<repo>/<ref>/<path>
  https://<host>/raw/<owner>/<repo>/refs/heads/<branch>/<path>
  https://<host>/p/<owner>/<repo>/<ref>/<path>  (if `GH_INJECT_RULES` includes `owner/repo`)
- api:
  https://<host>/api/repos/<owner>/<repo>/releases/latest
- gist:
  https://<host>/gist/<owner>/<gist_id>/raw/<file>
- github.com:
  https://<host>/<owner>/<repo>/raw/refs/heads/<branch>/<path>
  https://<host>/<owner>/<repo>/releases/download/<tag>/<file>
  git clone https://<host>/<owner>/<repo>.git
  git clone https://<host>/<owner>/<repo>

## Debug

- `GET /ip` returns client IP with `x-ip-source` header.
