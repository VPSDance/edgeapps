# Edgeapps

Monorepo for small edge apps that run on Cloudflare Workers and EdgeOne Pages
Functions.

## Apps

- `apps/gh-proxy`: GitHub proxy worker (CF + EdgeOne)

## Packages

- `packages/core`: shared proxy/auth/owners logic

## Quick start

```bash
pnpm install
pnpm --filter gh-proxy run build
```

See each app's README for deploy and config details.
