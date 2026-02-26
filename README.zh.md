# Edgeapps

Languages: [English](README.md) | [中文](README.zh.md)

面向 Cloudflare Workers 与 EdgeOne Pages 的边缘应用合集.

## 应用

- [`apps/gh-proxy`](apps/gh-proxy): GitHub 代理, 支持 raw/api/git clone 等加速.
- [`apps/short-url`](apps/short-url): 短链服务, 默认纯 KV 存储.
- [`apps/npm-registry`](apps/npm-registry): 私有 npm 仓库, R2 存储（仅 Cloudflare）.

## 包

- `packages/core`: 共享的 proxy/auth/owners 逻辑.

## 文档

- [`docs/platform-limits.zh.md`](docs/platform-limits.zh.md): Cloudflare / EdgeOne / KV / D1 / Supabase 免费与付费额度对比.

## 发布

### gh-proxy

```bash
pnpm install
cp edgeapps/apps/gh-proxy/gh-proxy.env.example ./gh-proxy.env
# 编辑 gh-proxy.env 填入变量
pnpm -F gh-proxy release
```
用 `-o cf|eo` 只发布单一目标.

### short-url

```bash
pnpm install
cp edgeapps/apps/short-url/short-url.env.example ./short-url.env
# 编辑 short-url.env 填入变量
pnpm -F short-url release
```

> 首次发布前需在 CF Dashboard 创建 Pages 项目并配置 KV 绑定和环境变量.

### npm-registry

```bash
pnpm install
cp edgeapps/apps/npm-registry/npm-registry.env.example ./npm-registry.env
# 编辑 npm-registry.env 填入变量
pnpm -F npm-registry release
```

> 首次发布前请在 Cloudflare Pages 配置 `NPM_BUCKET`（R2）与 `AUTH_KV`（KV）绑定.

## Smoke 测试

```bash
cp apps/gh-proxy/scripts/gh-proxy-smoke.env.example ./gh-proxy-smoke.env
bash apps/gh-proxy/scripts/gh-proxy-smoke.sh

cp apps/npm-registry/scripts/npm-registry-smoke.env.example ./npm-registry-smoke.env
bash apps/npm-registry/scripts/npm-registry-smoke.sh
```

详细的部署与配置请查看各应用的 README.
