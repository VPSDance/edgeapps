# Edgeapps

Languages: [English](README.md) | [中文](README.zh.md)

A collection of edge applications for Cloudflare Workers and EdgeOne Pages.

## Apps

- [`apps/gh-proxy`](apps/gh-proxy): GitHub proxy with raw/api/git clone acceleration.
- [`apps/short-url`](apps/short-url): URL shortener with KV storage + optional D1 stats.

## Packages

- `packages/core`: Shared proxy/auth/owners logic.

## Docs

- [`docs/platform-limits.zh.md`](docs/platform-limits.zh.md): Cloudflare / EdgeOne / KV / D1 / Supabase free vs paid limits comparison.

## Release

### gh-proxy

```bash
pnpm install
cp edgeapps/apps/gh-proxy/gh-proxy.env.example ./gh-proxy.env
# Edit gh-proxy.env with your values
pnpm -F gh-proxy release
```
Use `-o cf|eo` for single target.

### short-url

```bash
pnpm install
cp edgeapps/apps/short-url/short-url.env.example ./short-url.env
# Edit short-url.env with your values
pnpm -F short-url release
```

> Before first release, create Pages project in CF Dashboard and configure KV bindings and environment variables.

See each app's README for detailed deployment and configuration.
