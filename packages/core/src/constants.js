// owners 缓存时长（毫秒）
export const OWNERS_CACHE_TTL_MS = 60_000;

// 私有访问 token 有效期（分钟）
export const TOKEN_TTL_MIN = 60;

// 认证统计与封禁规则
export const AUTH_FAIL_TTL_DAYS = 7;
export const AUTH_BAN_AFTER = 5;
export const AUTH_BAN_WINDOW_MIN = 15;
export const AUTH_BAN_TTL_MIN = 1440;
export const AUTH_KV_PREFIX = 'auth:';
