# Platform Limits (Free vs Paid)

Languages: [English](platform-limits.md) | [中文](platform-limits.zh.md)

Last verified: 2026-02-09

This page is for quick comparison when choosing deployment/storage options for `edgeapps`.
Provider quotas change often; always re-check the source links before production launch.

## Quick Comparison

| Product | Free Plan | Paid Plan | Scope | Notes |
| --- | --- | --- | --- | --- |
| Cloudflare Workers & Pages | 100,000 requests/day, CPU time up to 10 ms per request | Workers Paid starts at $5/month, includes 10M requests/month, higher CPU limits (default 30s, configurable up to 300s for HTTP requests) | Per account | Shared runtime quota (account-level) |
| EdgeOne Pages (with Edge Functions) | 1M requests/month, 3M Edge Functions requests/month, 3M Edge Functions CPU time/month, 1GB KV storage/month | Business plan paid quotas are not publicly listed (page shows Priority Support + Custom Quotas only) | Per account | Pages + Edge Functions quota scope |
| Cloudflare KV | 1GB storage, 100k reads/day, 1k writes/day, 1k deletes/day, 1k list/day | Includes first 10GB storage/month, 10M reads/month, 1M writes/month, 1M deletes/month, 1M list/month; then pay-as-you-go | Per account | Useful for allowlists/counters/config |
| Cloudflare D1 | 10 databases/account, 500MB/database, 5GB total storage, 5M rows read/day, 100k rows written/day, 50 queries/invocation | 50,000 databases/account (increase on request), 10GB/database, 1TB account storage (increase on request), 1000 queries/invocation, first 25B rows read/month + 50M rows written/month + first 5GB storage included, then pay-as-you-go | Per account | SQLite-based managed SQL |
| Cloudflare R2 | 10GB-month storage, 1M write operations/month, 10M read operations/month, egress free | Standard: $0.015/GB-month, $4.50/M write operations, $0.36/M read operations; Infrequent Access: $0.01/GB-month, $9.00/M write operations, $0.90/M read operations, $0.01/GB data retrieval; egress free | Per account | S3-compatible object storage for static assets/uploads/backups |
| Supabase (D1 alternative for EdgeOne) | Up to 2 projects, 500MB DB/project, 5GB egress, 1GB file storage, up to 50,000 MAU | Pro from $25/month, supports multiple projects, 8GB disk/project, 250GB egress, 100GB file storage, up to 100,000 MAU | Per account | Free projects are auto-paused after 1 week of inactivity (paused projects do not count toward project quota) |

Note: MAU (Monthly Active Users) = distinct users who use Supabase Auth sign-in/sign-up in a month. If you do not use Supabase Auth, MAU does not apply.
Cloudflare note: KV/D1/R2 quotas are account-level and shared across Workers + Pages.

## Important Hard Limits

### Cloudflare KV
- Max key size: 512 bytes (512 B)
- Max value size: 26,214,400 bytes (25 MiB)
- Writes to same key: 1 write/second

### Cloudflare D1
- Max DB size: 500 MB (Free) / 10 GB (Paid)
- Max query result size: 2,000,000 bytes (2 MB)
- Max SQL statement length: 100,000 bytes (100 KB)

### Cloudflare R2
- Max object size: 5 TiB per object (single-part upload up to 5 GiB; multipart upload up to 4.995 TiB)
- Max buckets per account: 1,000,000
- Max object key length: 1,024 bytes
- Max concurrent writes to the same key: 1 write/second

### EdgeOne Edge Functions
- Code package size: up to 5 MB
- Request body size: up to 1,000,000 bytes (1 MB)
- CPU time: up to 200 ms/execution
- Runtime timeout and memory limits are not explicitly listed on the current Edge Functions "Use Limits" page

### Supabase Edge Functions
- Maximum function size: 20 MB (after CLI bundling)
- Max memory: 256 MB
- Max duration: Free 150 s, Paid 400 s
- Max CPU time: 2 s/request
- Max function count/project: Free 100, Pro 500, Team 1000, Enterprise unlimited

## Sources

- Cloudflare Workers pricing: https://workers.cloudflare.com/pricing
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare KV pricing: https://developers.cloudflare.com/kv/platform/pricing/
- Cloudflare KV limits: https://developers.cloudflare.com/kv/platform/limits/
- Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 limits: https://developers.cloudflare.com/r2/platform/limits/
- EdgeOne Pages pricing: https://pages.edgeone.ai/pricing
- EdgeOne Pages Edge Functions limits: https://pages.edgeone.ai/document/edge-functions
- EdgeOne KV (Tencent Cloud doc): https://cloud.tencent.com/document/product/1552/127420
- Supabase pricing: https://supabase.com/pricing
- Supabase Edge Functions limits: https://supabase.com/docs/guides/functions/limits
- Supabase MAU definition: https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users
