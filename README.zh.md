# Edgeapps

Languages: [English](README.md) | [中文](README.zh.md)

面向 Cloudflare Workers 与 EdgeOne Pages 的边缘应用合集.

## 应用

- [`apps/gh-proxy`](apps/gh-proxy): GitHub 代理, 支持 raw/api/git clone 等加速.
- [`apps/short-url`](apps/short-url): 短链服务, KV存储 + 可选D1统计.

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

详细的部署与配置请查看各应用的 README.
