# Edgeapps

Languages: [English](README.md) | [中文](README.zh.md)

面向 Cloudflare Workers 与 EdgeOne Pages 的边缘应用合集。

## 应用

- [`apps/gh-proxy`](apps/gh-proxy): GitHub 代理，支持 raw/api/git clone 等加速。

## 包

- `packages/core`: 共享的 proxy/auth/owners 逻辑。

## 发布

```bash
pnpm i
pnpm -F gh-proxy run release --
```
默认同时发布到 Cloudflare 与 EdgeOne；用 `-o cf|eo` 只发布单一目标（`cf`=Cloudflare，`eo`=EdgeOne）。

详细的部署与配置请查看各应用的 README。
