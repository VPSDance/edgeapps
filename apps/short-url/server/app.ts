// Hono Server for Short URL service
// Handles: API routes, short link redirect, static SPA serving
import { Hono } from 'hono'
import {
  getLink, getLinkUrl, createLink, updateLink, deleteLink, listLinks, getAllTags,
  type KVStore,
} from '../app/lib/kv-store'
import { requireAuth } from '@edgeapps/core/auth-guard'
import { handleStatsRequest } from '@edgeapps/core/stats'
import { isKvStore } from '@edgeapps/core/kv'
import { getPluginAdminEntries, handlePluginRequest, handlePluginResponse } from '@edgeapps/core/plugins'
import type { CreateLinkInput, UpdateLinkInput } from '../app/lib/types'

// __SPA_HTML__ is injected at build time via esbuild define
declare const __SPA_HTML__: string
declare const __EDGEAPPS_PLATFORM__: 'cf' | 'eo'

export type Bindings = {
  SHORT_URL_KV: KVStore
  AUTH_KV?: KVStore            // auth fail stats + auto-ban records
  ASSETS?: { fetch: typeof fetch }  // CF Pages static assets
  ADMIN_AUTH?: string               // "user:pass"
  SHORT_CODE_LENGTH?: string        // default "6"
}

const app = new Hono<{ Bindings: Bindings }>()

const ADMIN_HTML_HEADERS = {
  'cache-control': 'no-store, no-cache, must-revalidate',
  pragma: 'no-cache',
}

// ---------- Helpers ----------

function getConfig(env: Bindings) {
  return {
    adminAuth: env.ADMIN_AUTH || '',
    shortCodeLength: parseInt(env.SHORT_CODE_LENGTH || '6', 10),
  }
}

function createPluginContext(c: any) {
  const urlObj = new URL(c.req.url)
  return {
    request: c.req.raw,
    env: c.env,
    executionCtx: c.executionCtx,
    path: {
      raw: urlObj.pathname.replace(/^\/+/, ''),
      resolved: urlObj.pathname,
      search: urlObj.search,
    },
    meta: {
      version: 1,
      app: 'short-url',
      platform: __EDGEAPPS_PLATFORM__,
    },
  }
}

// ---------- Static assets (CF Pages) ----------
// Handled by adapter in server/cloudflare.ts or server/edgeone.ts
// app.ts is now platform-agnostic business logic only.

// ---------- Landing page ----------

app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Short URL Service</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #ededed; }
    .container { text-align: center; }
    h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
    p { color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔗 Short URL</h1>
    <p>快速、简洁的私有短链接服务</p>
    <p style="margin-top: 2rem; font-size: 0.875rem;">这是一个私有短链服务。如需使用请联系管理员。</p>
  </div>
</body>
</html>`)
})

// ---------- Auth middleware ----------

app.use('/_/*', async (c, next) => {
  const config = getConfig(c.env)
  if (!config.adminAuth) {
    return c.text('Admin auth not configured', 500)
  }

  if (!isKvStore(c.env.AUTH_KV)) {
    return c.text('AUTH_KV binding is required for admin auth auto-ban', 500)
  }

  const urlObj = new URL(c.req.url)
  if (urlObj.pathname === '/_/status') {
    await next()
    return
  }

  const authRes = await requireAuth(c.req.raw, {
    env: c.env,
    path: urlObj.pathname.replace(/^\/+/, ''),
    basicAuth: config.adminAuth,
    basicRealm: 'Short URL Admin'
  })
  if (!authRes.ok) return authRes.response

  await next()
})

// ---------- Plugin hooks ----------
// Allows private/plugins to extend behavior per app/platform scope.
app.use('*', async (c, next) => {
  const pluginCtxBase = createPluginContext(c)

  const preRes: any = await handlePluginRequest(pluginCtxBase)
  if (preRes instanceof Response) {
    return preRes
  }
  if (preRes && typeof preRes === 'object' && preRes.env && typeof preRes.env === 'object') {
    Object.assign(c.env as unknown as Record<string, unknown>, preRes.env as Record<string, unknown>)
  }

  await next()

  const postRes: any = await handlePluginResponse({
    ...pluginCtxBase,
    response: c.res,
  })
  if (postRes instanceof Response) {
    return postRes
  }
})

// ---------- API routes ----------

// GET /_/status (auth fail stats + ban status)
app.get('/_/status', async (c) => {
  const config = getConfig(c.env)
  const res = await handleStatsRequest(c.req.raw, c.env, {
    basicAuth: config.adminAuth,
    basicRealm: 'Short URL Admin'
  })
  if (res) return res
  return c.json({ ok: false, error: 'not_found' }, 404)
})

// GET /_/api/plugin/admin-entries
app.get('/_/api/plugin/admin-entries', async (c) => {
  const pluginCtx = createPluginContext(c)
  const rawEntries: any = await getPluginAdminEntries(pluginCtx)
  const entries = Array.isArray(rawEntries)
    ? rawEntries
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          id: String(item.id || ''),
          label: String(item.label || ''),
          path: String(item.path || ''),
          description: item.description ? String(item.description) : undefined,
          iframePath:
            item.iframePath && String(item.iframePath).startsWith('/_/')
              ? String(item.iframePath)
              : undefined,
        }))
        .filter((item) => item.id && item.label && item.path.startsWith('/'))
    : []
  return c.json({ entries })
})

// GET /_/api/links
app.get('/_/api/links', async (c) => {
  const kv = c.env.SHORT_URL_KV
  const search = c.req.query('search') || undefined
  const tag = c.req.query('tag') || undefined
  const limit = parseInt(c.req.query('limit') || '100', 10)

  try {
    const result = await listLinks(kv, { search, tag, limit })
    return c.json(result)
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to list links' }, 500)
  }
})

// POST /_/api/links
app.post('/_/api/links', async (c) => {
  const kv = c.env.SHORT_URL_KV
  const config = getConfig(c.env)

  try {
    const body = await c.req.json<CreateLinkInput>()
    if (!body.url) {
      return c.json({ error: 'URL is required' }, 400)
    }
    const link = await createLink(kv, body, config.shortCodeLength)
    return c.json(link, 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint') || e.message?.includes('already exists')) {
      return c.json({ error: 'Short code already exists' }, 409)
    }
    return c.json({ error: e.message || 'Failed to create link' }, 500)
  }
})

// GET /_/api/links/:code
app.get('/_/api/links/:code', async (c) => {
  const kv = c.env.SHORT_URL_KV
  const code = c.req.param('code')

  const link = await getLink(kv, code)
  if (!link) {
    return c.json({ error: 'Link not found' }, 404)
  }
  return c.json(link)
})

// PUT /_/api/links/:code
app.put('/_/api/links/:code', async (c) => {
  const kv = c.env.SHORT_URL_KV
  const code = c.req.param('code')

  try {
    const body = await c.req.json<UpdateLinkInput>()
    const link = await updateLink(kv, code, body)
    if (!link) {
      return c.json({ error: 'Link not found' }, 404)
    }
    return c.json(link)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint') || e.message?.includes('already exists')) {
      return c.json({ error: 'Short code already exists' }, 409)
    }
    return c.json({ error: e.message || 'Failed to update link' }, 500)
  }
})

// DELETE /_/api/links/:code
app.delete('/_/api/links/:code', async (c) => {
  const kv = c.env.SHORT_URL_KV
  const code = c.req.param('code')

  const deleted = await deleteLink(kv, code)
  if (!deleted) {
    return c.json({ error: 'Link not found' }, 404)
  }
  return c.json({ success: true })
})

// GET /_/api/tags
app.get('/_/api/tags', async (c) => {
  const kv = c.env.SHORT_URL_KV
  const tags = await getAllTags(kv)
  return c.json({ tags })
})

// ---------- Admin SPA ----------

// Serve SPA index.html for all admin routes
app.get('/_/admin', (c) => c.html(__SPA_HTML__, 200, ADMIN_HTML_HEADERS))
app.get('/_/admin/*', async (c) => {
  // Try static assets first (via CF ASSETS binding)
  if (c.env.ASSETS) {
    const resp = await c.env.ASSETS.fetch(c.req.raw)
    if (resp.status !== 404) return resp
  }
  // Fallback: serve SPA shell for client-side routing
  return c.html(__SPA_HTML__, 200, ADMIN_HTML_HEADERS)
})

// ---------- Short link redirect (MUST be last) ----------

app.get('/:code', async (c) => {
  const code = c.req.param('code')

  // Skip reserved prefixes
  if (code.startsWith('_')) {
    return c.notFound()
  }

  const kv = c.env.SHORT_URL_KV
  const url = await getLinkUrl(kv, code)
  if (!url) {
    return c.text('Short link not found', 404)
  }

  return c.redirect(url, 302)
})

export default app
