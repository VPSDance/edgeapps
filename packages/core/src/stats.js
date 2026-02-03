import { checkBasic } from "./auth.js";
import {
	AUTH_BAN_AFTER,
	AUTH_BAN_TTL_MIN,
	AUTH_BAN_WINDOW_MIN,
	AUTH_FAIL_TTL_DAYS,
	AUTH_KV_PREFIX,
} from "./constants.js";
import { jsonResponse, unauthorized } from "./http.js";
import { getClientIpInfo } from "./request.js";
import { isKvStore, normalizeKvKeys } from "./kv.js";

export function getRecordTtlSec() {
	const failTtl = Math.max(1, AUTH_FAIL_TTL_DAYS || 0) * 86400;
	const banTtl = Math.max(0, AUTH_BAN_TTL_MIN || 0) * 60 + 60;
	return Math.max(failTtl, banTtl);
}

export async function getAuthRecord(env, ip) {
	if (!isKvStore(env.AUTH_STATS)) return null;
	const raw = await env.AUTH_STATS.get(AUTH_KV_PREFIX + ip);
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function isRecordBanned(rec, now = Date.now()) {
	const until = rec?.fail?.banUntil || 0;
	return now < until;
}

export async function recordAuthEvent(env, { ip, kind, path, auth }) {
	if (!isKvStore(env.AUTH_STATS)) return null;
	const now = Date.now();
	const isFail = kind === "fail";
	const windowMs = isFail
		? Math.max(0, AUTH_BAN_WINDOW_MIN || 0) * 60 * 1000
		: 0;
	const rec = (await getAuthRecord(env, ip)) || { ip };
	let bucket;
	if (isFail) {
		if (!rec.fail) {
			rec.fail = { count: 0, firstTs: now, lastTs: now, banUntil: 0 };
		}
		bucket = rec.fail;
	} else {
		if (!rec.ok) {
			rec.ok = { count: 0, firstTs: now, lastTs: now };
		}
		bucket = rec.ok;
	}
	if (isFail && windowMs > 0 && now - bucket.firstTs > windowMs) {
		bucket.count = 0;
		bucket.firstTs = now;
		bucket.banUntil = 0;
	}
	bucket.count += 1;
	bucket.lastTs = now;
	bucket.lastPath = path || bucket.lastPath || "";
	bucket.lastAuth = auth || bucket.lastAuth || "";
	if (isFail && AUTH_BAN_AFTER > 0 && bucket.count >= AUTH_BAN_AFTER) {
		bucket.banUntil = now + AUTH_BAN_TTL_MIN * 60 * 1000;
	}
	try {
		await env.AUTH_STATS.put(AUTH_KV_PREFIX + ip, JSON.stringify(rec), {
			expirationTtl: getRecordTtlSec(),
		});
	} catch (err) {
		console.error(`auth${kind} put error`, err);
	}
	return rec;
}

export async function handleStatsRequest(req, env, cfg) {
	const urlObj = new URL(req.url);
	if (urlObj.pathname !== "/__/stats") return null;

	if (!checkBasic(req, { basicAuth: cfg.basicAuth })) return unauthorized(cfg.basicRealm);
	const clientInfo = getClientIpInfo(req);
	const hasAuthKv = isKvStore(env?.AUTH_STATS);
	const hasAllowKv = isKvStore(env?.GH_ALLOW_KV);
	const bindings = {
		auth_stats: hasAuthKv,
		gh_allow_kv: hasAllowKv,
	};
	if (!hasAuthKv) {
		return jsonResponse(
			{
				ok: false,
				error: "kv not bound",
				client_ip: clientInfo.ip,
				client_ip_source: clientInfo.source,
				...bindings,
			},
			503,
		);
	}
	const limitRaw = Number(urlObj.searchParams.get("limit") || "50");
	const limit = Math.max(
		1,
		Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 50),
	);
	const cursor = urlObj.searchParams.get("cursor");
	const listOpts = { prefix: AUTH_KV_PREFIX, limit };
	if (cursor) listOpts.cursor = cursor;
	const listRes = await env.AUTH_STATS.list(listOpts);
	const keys = normalizeKvKeys(listRes);

	const now = Date.now();
	const items = (
		await Promise.all(
			keys.map(async (name) => {
				const raw = await env.AUTH_STATS.get(name);
				if (!raw) return null;
				try {
					return JSON.parse(raw);
				} catch {
					return null;
				}
			}),
		)
	)
		.filter(Boolean)
		.map((rec) => ({ ...rec, banned: isRecordBanned(rec, now) }));

	return jsonResponse({
		ok: true,
		now,
		client_ip: clientInfo.ip,
		client_ip_source: clientInfo.source,
		...bindings,
		next_cursor: listRes.cursor || "",
		items,
	});
}
