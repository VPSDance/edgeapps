# NPM Registry

Languages: [English](README.md) | [中文](README.zh.md)

Private npm registry for Cloudflare Pages with R2 object storage.

## Scope (MVP)

- `npm install` / `npm view` (metadata + tarball download)
- `npm publish` (single/multi-version payload with `_attachments`)
- `npm dist-tag add|rm` compatible tag update endpoint
- Token auth via `NPM_AUTH_KV` (dynamic) or `NPM_ACCOUNTS_JSON` (static)
- Upstream fallback for public packages (`https://registry.npmjs.org`)
- Auth fail stats + auto-ban via `AUTH_KV`
- Public landing at `/`, admin UI at `/_/admin` (package list, dist-tag update, delete version)

This app is currently **Cloudflare-only**.

## Endpoints

Public routes:
- `GET /` (public landing page)

npm-compatible routes:
- `GET /-/ping`
- `GET /-/whoami`
- `POST /-/npm/v1/security/advisories/bulk` (npm audit passthrough)
- `POST /-/npm/v1/security/audits/quick` (npm audit passthrough)
- `GET /<package>`
- `PUT /<package>`
- `PUT /<package>/-rev/<rev>` (npm unpublish packument update)
- `DELETE /<package>/-rev/<rev>` (npm unpublish whole package)
- `GET /-/tarballs/<encoded-package>/<version>.tgz`
- `DELETE /-/tarballs/<encoded-package>/<version>.tgz/-rev/<rev>` (npm unpublish tarball delete)
- `GET /-/package/<encoded-package>/dist-tags`
- `PUT /-/package/<encoded-package>/dist-tags/<tag>`
- `DELETE /-/package/<encoded-package>/dist-tags/<tag>`

Private admin routes:
- `GET /_/status`
- `GET /_/admin` (admin UI, HTTP Basic auth)
- `GET /_/api/admin/tokens` (list own tokens, KV mode)
- `POST /_/api/admin/token-create` (create token, KV mode)
- `POST /_/api/admin/token-update` (update token ACL/admin role, KV mode)
- `POST /_/api/admin/token-rotate` (generate new token and invalidate old token, KV mode)
- `POST /_/api/admin/token-delete` (delete token, KV mode)

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

## Smoke test

Run commands from the repo root README: [`../../README.md`](../../README.md).

Write-path behavior:
- Default: auto publish a temporary package, run publish + dist-tag + unpublish checks
- Single token is enough if it has both read/write ACL (`NPM_REGISTRY_TOKEN`)
- `NPM_REGISTRY_WRITE_TOKEN` is optional override for write-path checks
- Required: `NPM_REGISTRY_WRITE_TEST_PACKAGE` (package name for write-path tests)
- Examples (pick one):
  - scoped: `@your-scope/smoke`
  - unscoped: `your-team-smoke`
- Required: `NPM_REGISTRY_READ_TEST_PACKAGE` (package name for read-path checks)

## Cloudflare Config

Variables and Secrets:
- `NPM_ACCOUNTS_JSON` (optional; env-account auth and fallback when KV token is not matched)
- `NPM_UPSTREAM_REGISTRY` (optional, default: `https://registry.npmjs.org`)
- `NPM_ALLOW_REPUBLISH` (optional, default: `true`)

`NPM_ACCOUNTS_JSON` example:

```json
[
  {
    "username": "alice",
    "token": "token_alice",
    "admin": true
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

ACL rule syntax:
- Exact match: no `*`, e.g. `@team/pkg-a`
- Wildcard: `*` matches any substring, e.g. `@team/*`, `xxx-*`, `*`
- If `read` is omitted but `write` exists: `read` defaults to `write`
- If both `read` and `write` are omitted: `read` defaults to `*` and `write` is empty
- If `admin: true`: account/token is forced to full access (`read=["*"]`, `write=["*"]`)

Republish behavior:
- Default (`NPM_ALLOW_REPUBLISH=true`): existing version can be overwritten (Nexus-like behavior).
- If `NPM_ALLOW_REPUBLISH=false`: immutable versions, same version publish returns `409 version_exists`.

Bindings:
- R2: binding variable `NPM_BUCKET` -> your actual bucket (e.g. `npm-registry`)
- KV: `NPM_AUTH_KV` (dynamic token storage for npm auth, optional)
- KV: `AUTH_KV` (auth fail tracking + auto-ban)

Auth source:
- If `NPM_AUTH_KV` is bound: npm auth checks KV tokens (`npr_<tokenId>.<secret>`) first.
- If KV does not match and `NPM_ACCOUNTS_JSON` exists: it is used as fallback (good for admin accounts).
- If `NPM_AUTH_KV` is not bound: npm auth uses `NPM_ACCOUNTS_JSON` only.
- Token management policy: only `admin: true` accounts can access token management (UI + API).
- Token role default: new tokens are non-admin unless an admin explicitly creates them as admin.

Admin UI auth:
- Open `/_/admin` and sign in with HTTP Basic.
- Username: token owner username
- Password: corresponding token

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
