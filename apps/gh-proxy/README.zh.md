# GH Proxy

面向 Cloudflare Workers 与 EdgeOne Pages Functions 的 GitHub 代理。

语言: [English](README.md) | [中文](README.zh.md)

## 结构

- Cloudflare: `src/cf/index.js`
- EdgeOne（根首页）: `src/edgeone/edge-functions/index.js`
- EdgeOne（代理入口）: `src/edgeone/edge-functions/[[default]].js`
- 构建输出: `dist/cf` + `dist/eo`

## 构建

```bash
cd apps/gh-proxy
pnpm install
pnpm run build
```

输出:
- `dist/cf/_worker.js`
- `dist/cf/favicon.ico`
- `dist/eo/edge-functions/index.js`
- `dist/eo/edge-functions/[[default]].js`
- `dist/eo/favicon.ico`

## 发布（构建 + 部署）

```bash
cp gh-proxy.env.example ./gh-proxy.env
pnpm release
```
在 `apps/gh-proxy` 下执行（或从仓库根目录用 workspace 脚本）。
发布前编辑 `gh-proxy.env` 填入你的变量。

必需环境变量（短名）:
- EO_NAME, EO_TOKEN
- CF_NAME, CF_TOKEN, CF_ACCOUNT

说明:
- 脚本会优先读取 `gh-proxy.env`（仓库根目录或 app 目录），否则使用当前 shell 的 env。
- CF_ACCOUNT 为 Cloudflare 账号 ID（控制台 URL `/accounts/<ACCOUNT_ID>` 或 Workers & Pages 页面可见）。

发布选项:
- `--dry-run`（只打印命令不执行；`pnpm release -- --dry-run`）
- `--skip-build`（仅部署已有 dist；`pnpm release -- --skip-build`）
- `-o cf|eo`（只发布单一目标；`cf`=Cloudflare，`eo`=EdgeOne；`pnpm release -- -o cf`）

## Smoke 测试

执行命令见仓库根 README: [`../../README.zh.md`](../../README.zh.md)。

Smoke 变量说明:
- 必填: `GH_PROXY_HOSTS`、公共仓库字段、gist 字段、user-attachments 字段。
- 可选: `GH_PROXY_BASIC`（basic auth 路由测试）、`GH_PROXY_TOKEN` + `GH_PROXY_PRIVATE_*`（私有 raw/clone 测试）。

## 配置

必需:
- GH_ALLOW_RULES: 允许列表（逗号分隔：`owner,owner/repo,owner/gistId`；`*` 表示放开所有）。也会限制 `git clone`。

可选:
- GH_INJECT_RULES: raw 私有仓库的自动携带 `GH_INJECT_TOKEN` 规则（格式同 GH_ALLOW_RULES；`*` 表示全部）。
- GH_INJECT_TOKEN: 命中 GH_INJECT_RULES 时自动携带的 raw token。
- GH_API_TOKEN: api.github.com 的 token（减少 rate-limit/403/429）。
- BASIC_AUTH_RULES: 需要 Basic 认证的目标（适合私有访问；格式同 GH_ALLOW_RULES；`*` 表示全部）。
- BASIC_AUTH: BASIC_AUTH_RULES 对应的 Basic 认证账号密码（格式 `user:pass`；设置 BASIC_AUTH_RULES 时必须配置）。
- LANDING_HTML: 覆盖 `/` 首页 HTML。

KV 绑定:
- GH_KV: 可选的 allowlist 存储（key: `allow_rules`），用于大规则集。
- AUTH_KV: 开启 `BASIC_AUTH_RULES` 时必需（用于认证失败统计与自动封禁）。

## 示例

基础（允许指定 owner）:
```bash
GH_ALLOW_RULES=owner,owner2
```

私有仓库（raw 服务端自动携带 token）:
```bash
GH_ALLOW_RULES=owner/private-repo
GH_INJECT_RULES=owner/private-repo
GH_INJECT_TOKEN=ghp_xxx
```

Basic 认证保护:
```bash
GH_ALLOW_RULES=owner
BASIC_AUTH_RULES=owner/private-repo
BASIC_AUTH=user:pass
```
开启 `BASIC_AUTH_RULES` 时，请配置 `AUTH_KV` 以启用 `/_/status` 与认证失败统计/封禁（默认：15 分钟内 5 次失败 → 封禁 24 小时）。

## 使用（EdgeOne/CF）

```text
raw:
  https://<host>/raw/<owner>/<repo>/<ref>/<path>
  https://<host>/raw/<owner>/<repo>/refs/heads/<branch>/<path>
  https://<token>@<host>/raw/<owner>/<repo>/<ref>/<path>
  https://<host>/https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
api:
  https://<host>/api/repos/<owner>/<repo>/releases/latest
  https://<host>/https://api.github.com/repos/<owner>/<repo>/releases/latest
gist:
  https://<host>/gist/<owner>/<gist_id>/raw/<file>
  https://<host>/https://gist.githubusercontent.com/<owner>/<gist_id>/raw/<file>
github.com:
  https://<host>/<owner>/<repo>/raw/refs/heads/<branch>/<path>
  https://<host>/<owner>/<repo>/releases/latest
  # releases/latest 会返回 302，且 Location 会重写到当前代理域名
  https://<host>/<owner>/<repo>/releases/download/<tag>/<file>
  https://<host>/<owner>/<repo>/archive/refs/heads/<branch>.zip
  https://<host>/<owner>/<repo>/archive/refs/tags/<tag>.tar.gz
  https://<host>/https://github.com/<owner>/<repo>/raw/refs/heads/<branch>/<path>
  https://<host>/https://github.com/<owner>/<repo>/releases/latest
  https://<host>/https://github.com/<owner>/<repo>/archive/refs/heads/<branch>.zip
  https://<host>/https://github.com/<owner>/<repo>/archive/refs/tags/<tag>.tar.gz
git:
  git clone https://<host>/<owner>/<repo>.git
  git clone https://<host>/<owner>/<repo>
  git clone https://<token>@<host>/<owner>/<repo>.git
  git clone https://<host>/https://github.com/<owner>/<repo>.git
attachments（需要 GH_ALLOW_RULES 包含 user-attachments）:
  https://<host>/user-attachments/files/<id>/<file>
  https://<host>/user-attachments/assets/<id>
  https://<host>/https://github.com/user-attachments/files/<id>/<file>
  https://<host>/https://github.com/user-attachments/assets/<id>
```

## 内置路由

- `GET /_/status`: 认证统计/封禁信息（需要 `AUTH_KV` + `BASIC_AUTH`）。
- `GET /_/ip`: 返回客户端 IP（EdgeOne Pages 暂不支持 IPv6）。
- `GET /_/auth`: Basic 认证探测（测试用，需要 `BASIC_AUTH`）。
