# 平台额度与限制(免费版 vs 付费版)

语言: [English](platform-limits.md) | [中文](platform-limits.zh.md)

最后核对时间: 2026-02-09

该页用于 `edgeapps` 的额度快速对比, 方便做平台和存储选型.
各平台额度会频繁调整, 正式上线前请再核对文末官方链接.

## 快速对比

| 产品 | 免费版 | 付费版 | Scope | 备注 |
| --- | --- | --- | --- | --- |
| Cloudflare Workers & Pages | 10 万次请求/天;单次请求 CPU 时间最多 10 ms | Workers Paid 起步 $5/月, 含 1000 万次请求/月;CPU 限制更高(默认 30s, HTTP 请求可配到 300s) | 按账号 | 运行时配额按账号共享 |
| EdgeOne Pages(含 Edge Functions) | 100 万次请求/月, 300 万次 Edge Functions 请求/月, 300 万次 Edge Functions CPU 时间/月, 1GB KV 存储/月 | Business 版额度暂未公开具体数字(页面仅显示 Priority Support + Custom Quotas) | 按账号 | 按 Pages + Edge Functions 配额口径 |
| Cloudflare KV | 1GB 存储, 10 万次读/天, 1000 次写/天, 1000 次删/天, 1000 次 list/天 | 含前 10GB 存储/月, 1000 万次读/月, 100 万次写/月, 100 万次删/月, 100 万次 list/月;超出按量计费 | 按账号 | 适合白名单, 计数器, 配置数据 |
| Cloudflare D1 | 每账号 10 个数据库, 每库 500MB, 总存储 5GB, 500 万行读取/天, 10 万行写入/天, 每次调用最多 50 个查询 | 每账号 50,000 个数据库(可申请提升), 每库 10GB, 账号总存储 1TB(可申请提升), 每次调用最多 1000 个查询, 含前 250 亿行读取/月 + 5000 万行写入/月 + 前 5GB 存储;超出按量计费 | 按账号 | 基于 SQLite 的托管 SQL |
| Cloudflare R2 | 10GB-月存储, 每月 100 万次写入类操作, 每月 1000 万次读取类操作, 出网流量免费 | Standard: $0.015/GB-月, $4.50/百万次写入类操作, $0.36/百万次读取类操作; Infrequent Access: $0.01/GB-月, $9.00/百万次写入类操作, $0.90/百万次读取类操作, $0.01/GB 数据取回; 出网流量免费 | 按账号 | S3 兼容对象存储, 适合静态资源/上传文件/备份 |
| Supabase(EdgeOne 下 D1 替代) | 最多 2 个项目, 每项目 500MB 数据库, 5GB 出网流量, 1GB 文件存储, 最多 5 万 MAU | Pro 起步 $25/月, 支持多项目, 每项目 8GB 磁盘, 250GB 出网流量, 100GB 文件存储, 最多 10 万 MAU | 按账号 | 免费项目闲置 1 周后会自动暂停(暂停后不计入项目数限制) |

备注: MAU(月活跃用户) = 每月使用 Supabase Auth 登录/注册的独立用户数; 如果不用 Supabase Auth 功能, 则不计入 MAU.
Cloudflare 说明: KV/D1/R2 都是账号级配额, Workers 与 Pages 共享.

## 关键硬限制

### Cloudflare KV
- Key 最大 512 字节(512 B)
- Value 最大 26,214,400 字节(25 MiB)
- 同一个 Key 写入频率上限: 1 次/秒

### Cloudflare D1
- 单数据库最大: 500 MB(Free) / 10 GB(Paid)
- 查询返回最大 2,000,000 字节(2 MB)
- 单条 SQL 语句最大 100,000 字节(100 KB)

### Cloudflare R2
- 单对象最大 5 TiB(单次上传上限 5 GiB; 分片上传上限 4.995 TiB)
- 每账号最多 1,000,000 个 bucket
- 对象 key 最大长度 1,024 字节
- 同一 key 并发写入上限: 1 次/秒

### EdgeOne Edge Functions
- 代码包大小上限 5 MB
- 请求体大小上限 1,000,000 字节(1 MB)
- CPU 时间上限 200 ms/次执行
- 当前官方 Edge Functions "Use Limits" 页未明确给出运行时内存和超时上限

### Supabase Edge Functions
- 函数打包体积上限 20 MB(CLI 打包后)
- 内存上限 256 MB
- 执行时长: Free 150 s, Paid 400 s
- CPU 时间上限: 2 s/请求
- 每项目函数数量: Free 100, Pro 500, Team 1000, Enterprise 不限

## 官方来源

- Cloudflare Workers 定价: https://workers.cloudflare.com/pricing
- Cloudflare Workers 限制: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare KV 定价: https://developers.cloudflare.com/kv/platform/pricing/
- Cloudflare KV 限制: https://developers.cloudflare.com/kv/platform/limits/
- Cloudflare D1 定价: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 限制: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare R2 定价: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 限制: https://developers.cloudflare.com/r2/platform/limits/
- EdgeOne Pages 定价: https://pages.edgeone.ai/pricing
- EdgeOne Pages Edge Functions 限制: https://pages.edgeone.ai/document/edge-functions
- EdgeOne KV(腾讯云文档): https://cloud.tencent.com/document/product/1552/127420
- Supabase 定价: https://supabase.com/pricing
- Supabase Edge Functions 限制: https://supabase.com/docs/guides/functions/limits
- Supabase MAU 说明: https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users
