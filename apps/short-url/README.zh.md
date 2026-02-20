# 短链服务

语言: [English](README.md) | [中文](README.zh.md)

面向 Cloudflare Pages 和 EdgeOne Pages 的短链服务。

## 功能

- ✅ 短链跳转 (KV 读取，0 次写入)
- ✅ CRUD + 标签管理
- ✅ Radix UI 管理界面

## 部署

### 1. 创建 Pages 项目

**Cloudflare:**
```bash
npx wrangler pages project create short-url --production-branch main
```

**EdgeOne:**
在 [EdgeOne Pages 控制台](https://edgeone.ai/pages) 创建项目。

### 2. 配置绑定

在 Pages 项目设置 → Functions → Bindings:

| 类型 | 名称 | 说明 |
|------|------|------|
| KV | `SHORT_URL_KV` | 必需，存储链接数据 |
| Env | `ADMIN_AUTH` | 格式 `用户名:密码` |
| Env | `SHORT_CODE_LENGTH` | 默认 6 |

### 3. 发布

```bash
# 在 workers/ 目录
cp edgeapps/apps/short-url/short-url.env.example ./short-url.env
# 编辑 short-url.env

# 同时部署到 CF 和 EdgeOne
pnpm -F short-url release

# 仅部署到 Cloudflare
pnpm -F short-url release -- -o cf

# 仅部署到 EdgeOne
pnpm -F short-url release -- -o eo
```

### 构建产物

- Cloudflare: `dist/cf`（`_worker.js` + 静态资源）
- EdgeOne: `dist/eo`（`edge-functions` + 静态资源）

> [!WARNING]
> **EdgeOne Pages 兼容性**
> 当前的 SSR 构建依赖 React Router 7 所需的 Node.js API（例如 `AsyncLocalStorage`），而 EdgeOne 标准运行时环境可能缺失这些 API，导致 500/545 错误。
> **推荐使用 Cloudflare Pages**，因为它提供完整的 `nodejs_compat` 支持。

## 使用

- 管理界面: `https://your-domain/_/admin`
- 短链接: `https://your-domain/<code>`
