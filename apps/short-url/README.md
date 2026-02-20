# Short URL

Languages: [English](README.md) | [中文](README.zh.md)

URL shortening service for Cloudflare Pages and EdgeOne Pages.

## Features

- ✅ Short link redirect (KV read, 0 writes)
- ✅ CRUD + tag management
- ✅ Radix UI admin interface

## Deployment

### 1. Create Pages Project

**Cloudflare:**
```bash
npx wrangler pages project create short-url --production-branch main
```

**EdgeOne:**
Create project at [EdgeOne Pages Console](https://edgeone.ai/pages).

### 2. Configure Bindings

In Pages project Settings → Functions → Bindings:

| Type | Name | Description |
|------|------|-------------|
| KV | `SHORT_URL_KV` | Required, stores link data |
| Env | `ADMIN_AUTH` | Format `user:password` |
| Env | `SHORT_CODE_LENGTH` | Default 6 |

### 3. Release

```bash
# In workers/ directory
cp edgeapps/apps/short-url/short-url.env.example ./short-url.env
# Edit short-url.env

# Deploy to both CF and EdgeOne
pnpm -F short-url release

# Deploy to Cloudflare only
pnpm -F short-url release -- -o cf

# Deploy to EdgeOne only
pnpm -F short-url release -- -o eo
```

### Build Outputs

- Cloudflare: `dist/cf` (`_worker.js` + static assets)
- EdgeOne: `dist/eo` (`edge-functions` + static assets)

## Architecture

- **Frontend**: React SPA (Admin UI), built with **Rsbuild**.
- **Backend**: Hono Server (API & Redirects), bundled with **Esbuild**.
- **Data**: KV Store (Cross-platform).

## Usage

- Admin UI: `https://your-domain/_/admin`
- Short link: `https://your-domain/<code>`
