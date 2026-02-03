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
npm install
npm run build
```

Outputs:
- `dist/cf/index.js`
- `dist/edgeone/edge-functions/index.js`
- `dist/edgeone/edge-functions/[[default]].js`

## Release (build + publish)

```bash
npm run release
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

## Proxy config (Cloudflare/EdgeOne)

Env vars:
- GH_TOKEN: optional GitHub token (used for api/raw auth)
- GH_ALLOW: allowlist (comma-separated; e.g. `owner,owner/repo,owner/gistId`)
- BASIC_AUTH: Basic auth in `user:pass` form (used for protected paths)
- LANDING_HTML: optional HTML string for `/` (default `<a></a>`)

KV bindings:
- GH_ALLOW_KV: allowlist storage (key: `allow`, value same format as GH_ALLOW)
- AUTH_STATS: auth stats/ban

Notes:
- GH_ALLOW is case-sensitive; env size ~5 KB (few hundred owners; use GH_ALLOW_KV for large lists).

## GH Proxy usage (EdgeOne/CF)

- raw:
  https://<host>/raw/<owner>/<repo>/<ref>/<path>
  https://<host>/raw/<owner>/<repo>/refs/heads/<branch>/<path>
- api:
  https://<host>/api/repos/<owner>/<repo>/releases/latest
- gist:
  https://<host>/gist/<owner>/<gist_id>/raw/<file>
- github.com:
  https://<host>/<owner>/<repo>/raw/refs/heads/<branch>/<path>
  https://<host>/<owner>/<repo>/releases/download/<tag>/<file>

## Debug

- `GET /ip` returns client IP with `x-ip-source` header.
