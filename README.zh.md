# Edgeapps

Languages: [English](README.md) | [中文](README.zh.md)

面向 Cloudflare Workers 与 EdgeOne Pages 的边缘应用合集。

## 应用

- [`apps/gh-proxy`](apps/gh-proxy): GitHub 代理，支持 raw/api/git clone 等加速。

## 包

- `packages/core`: 共享的 proxy/auth/owners 逻辑。

## 快速开始

```bash
pnpm install
pnpm --filter gh-proxy run build
```

部署与配置请查看各应用的 README。
