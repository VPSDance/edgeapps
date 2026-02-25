# NPM Registry

Languages: [English](README.md) | [中文](README.zh.md)

Private npm registry for Cloudflare Pages with R2 object storage.

## Scope (MVP)

- `npm install` / `npm view` (metadata + tarball download)
- `npm publish` (single/multi-version payload with `_attachments`)
- `npm dist-tag add|rm` compatible tag update endpoint
- Token auth via `NPM_ACCOUNTS_JSON` (per-account, per-package ACL)
- Upstream fallback for public packages (`https://registry.npmjs.org`)
- Auth fail stats + auto-ban via `AUTH_KV`
- Public landing at `/`, admin UI at `/_/admin` (package list, dist-tag update, delete version)

This app is currently **Cloudflare-only**.

## Endpoints

- `GET /-/ping`
- `GET /-/whoami`
- `GET /_/status`
- `GET /` (public landing page)
- `GET /login` (redirect to `/_/admin`)
- `GET /_/admin` (admin UI, HTTP Basic auth)
- `GET /<package>`
- `PUT /<package>`
- `GET /-/tarballs/<encoded-package>/<version>.tgz`
- `PUT /-/package/<encoded-package>/dist-tags/<tag>`

## Build

```bash
cd apps/npm-registry
pnpm install
pnpm run build
```

Output:
- `dist/cf/_worker.js`
- `dist/cf/static/*` (hashed admin assets built by Rsbuild)

## Release

```bash
cp npm-registry.env.example ./npm-registry.env
pnpm release
```

Required env for release script (`npm-registry.env`):
- `CF_NAME`, `CF_TOKEN`, `CF_ACCOUNT`

## Cloudflare Config

Variables and Secrets:
- `NPM_ACCOUNTS_JSON` (required)
- `NPM_UPSTREAM_REGISTRY` (optional, default: `https://registry.npmjs.org`)
- `NPM_ALLOW_REPUBLISH` (optional, default: `true`)

`NPM_ACCOUNTS_JSON` example:

```json
[
  {
    "username": "alice",
    "token": "token_alice",
    "read": ["*"],
    "write": ["@team/*"]
  },
  {
    "username": "ci",
    "token": "token_ci",
    "read": ["@team/*"],
    "write": ["@team/pkg-a"]
  }
]
```
Token: `openssl rand -hex 16` (recommended: `openssl rand -hex 32`).

Republish behavior:
- Default (`NPM_ALLOW_REPUBLISH=true`): existing version can be overwritten (Nexus-like behavior).
- If `NPM_ALLOW_REPUBLISH=false`: immutable versions, same version publish returns `409 version_exists`.

Bindings:
- R2: binding variable `NPM_BUCKET` -> your actual bucket (e.g. `npm-registry`)
- KV: `AUTH_KV` (auth fail tracking + auto-ban)

Admin UI auth:
- Open `/_/admin` and sign in with HTTP Basic.
- Username: `NPM_ACCOUNTS_JSON[].username`
- Password: corresponding account `token`

## npm client setup

Set default registry via npm config:

```bash
npm config set registry https://your-registry-domain/
npm config set always-auth true
```

Use project or user `.npmrc`:

```ini
registry=https://your-registry-domain/
//your-registry-domain/:_authToken=YOUR_ACCOUNT_TOKEN
always-auth=true
```

`npm login` is also supported (legacy endpoint): use `username` from `NPM_ACCOUNTS_JSON`, and enter the account `token` as password.
Recommended command for this registry: `npm login --auth-type=legacy --registry=https://your-registry-domain/`.
