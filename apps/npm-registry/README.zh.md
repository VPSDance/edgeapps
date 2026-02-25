# NPM 仓库

Languages: [English](README.md) | [中文](README.zh.md)

基于 Cloudflare Pages + R2 的私有 npm 仓库。

## 功能范围（MVP）

- 支持 `npm install` / `npm view`（元数据 + tarball 下载）
- 支持 `npm publish`（处理 `_attachments`）
- 支持 `npm dist-tag` 的基础更新接口
- Token 鉴权基于 `NPM_ACCOUNTS_JSON`（多账号 + 按包 ACL）
- 支持公共包 upstream 回源（`https://registry.npmjs.org`）
- 基于 `AUTH_KV` 的鉴权失败统计与自动封禁
- 提供公开首页 `/`，管理页在 `/_/admin`（包列表、dist-tag 更新、删除版本）

当前版本仅支持 **Cloudflare**。

## 接口

- `GET /-/ping`
- `GET /-/whoami`
- `GET /_/status`
- `GET /`（公开首页）
- `GET /login`（跳转到 `/_/admin`）
- `GET /_/admin`（管理页，需要 HTTP Basic 认证）
- `GET /<package>`
- `PUT /<package>`
- `GET /-/tarballs/<encoded-package>/<version>.tgz`
- `PUT /-/package/<encoded-package>/dist-tags/<tag>`

## 构建

```bash
cd apps/npm-registry
pnpm install
pnpm run build
```

产物:
- `dist/cf/_worker.js`
- `dist/cf/static/*`（Rsbuild 构建的带 hash 管理端静态资源）

## 发布

```bash
cp npm-registry.env.example ./npm-registry.env
pnpm release
```

发布脚本必需变量（`npm-registry.env`）:
- `CF_NAME`, `CF_TOKEN`, `CF_ACCOUNT`

## Cloudflare 配置

变量和机密（Variables and Secrets）:
- `NPM_ACCOUNTS_JSON`（必填）
- `NPM_UPSTREAM_REGISTRY`（可选，默认 `https://registry.npmjs.org`）
- `NPM_ALLOW_REPUBLISH`（可选，默认 `true`）

`NPM_ACCOUNTS_JSON` 示例:

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
Token 生成: `openssl rand -hex 16`（推荐: `openssl rand -hex 32`）。

重发同版本行为:
- 默认（`NPM_ALLOW_REPUBLISH=true`）: 允许覆盖已有版本（类似 Nexus）。
- 关闭（`NPM_ALLOW_REPUBLISH=false`）: 版本不可变，同版本重复发布返回 `409 version_exists`。

绑定（Bindings）:
- R2: 绑定变量名 `NPM_BUCKET` -> 实际桶名（例如 `npm-registry`）
- KV: `AUTH_KV`（用于鉴权失败统计 + 自动封禁）

管理页认证:
- 打开 `/_/admin`，使用 HTTP Basic 登录
- 用户名: `NPM_ACCOUNTS_JSON[].username`
- 密码: 对应账号的 `token`

## npm 客户端配置

使用 npm config 设置默认 registry:

```bash
npm config set registry https://your-registry-domain/
npm config set always-auth true
```

项目或用户级 `.npmrc`:

```ini
registry=https://your-registry-domain/
//your-registry-domain/:_authToken=YOUR_ACCOUNT_TOKEN
always-auth=true
```

也支持 `npm login`（legacy 路由）: `username` 填 `NPM_ACCOUNTS_JSON` 里的账号名，`password` 填该账号 token。
此仓库推荐命令: `npm login --auth-type=legacy --registry=https://your-registry-domain/`。
