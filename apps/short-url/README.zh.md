# 短链服务

语言: [English](README.md) | [中文](README.zh.md)

面向 Cloudflare Pages 和 EdgeOne Pages 的短链服务。

## 功能

- ✅ 短链跳转 (KV 读取，0 次写入)
- ✅ CRUD + 标签管理
- ✅ Radix UI 管理界面
- ✅ 管理员认证自动封禁（需配置 `AUTH_KV`）

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
| KV | `AUTH_KV` | 用于管理员认证失败统计与自动封禁 |
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

## 使用

- 管理界面: `https://your-domain/_/admin`
- 短链接: `https://your-domain/<code>`
- 认证状态: `https://your-domain/_/status`（需要管理员 Basic 认证）
