# Edgeapps

Languages: [English](README.md) | [中文](README.zh.md)

A collection of edge applications powered by Cloudflare Workers and EdgeOne Pages.

## Applications

- [`apps/gh-proxy`](apps/gh-proxy): GitHub proxy with edge acceleration for raw/api/git clone.

## Packages

- `packages/core`: shared proxy/auth/owners logic.

## Quick start

```bash
pnpm install
pnpm --filter gh-proxy run build
```

See each app README for deploy and config details.
