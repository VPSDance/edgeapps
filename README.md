# Edgeapps

Languages: [English](README.md) | [中文](README.zh.md)

A collection of edge applications powered by Cloudflare Workers and EdgeOne Pages.

## Applications

- [`apps/gh-proxy`](apps/gh-proxy): GitHub proxy with edge acceleration for raw/api/git clone.

## Packages

- `packages/core`: shared proxy/auth/owners logic.

## Release

```bash
pnpm install
cp apps/gh-proxy/gh-proxy.env.example ./gh-proxy.env
pnpm -F gh-proxy run release --
```
Edit `gh-proxy.env` with your credentials before release.
Default deploys to Cloudflare and EdgeOne. Use `-o cf|eo` to deploy only one (`cf` = Cloudflare, `eo` = EdgeOne).

See each app README for deploy and config details.
