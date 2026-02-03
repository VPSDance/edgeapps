import { OWNERS_CACHE_TTL_MS } from "./constants.js";

let cachedOwners = null;
let cachedAt = 0;
let cachedKey = "";

export function parseOwners(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return [];
		return trimmed
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
	}
	return [];
}

export const DEFAULT_OWNERS = [];

export function resolveOwners(env, fallbackOwners = []) {
	const envOwners = parseOwners(env?.GH_ALLOW_RULES);
	return [...fallbackOwners, ...envOwners];
}

export async function loadAllowedOwners({
	env,
	kv,
	defaultOwners = [],
	ttlMs = OWNERS_CACHE_TTL_MS,
	kvKey = "allow",
} = {}) {
	const now = Date.now();
	const kvStore = kv || env?.GH_ALLOW_RULES_KV;
	const cacheKey = `${kvKey}:${defaultOwners.join(",")}:${Boolean(kvStore)}`;
	if (cachedOwners && now - cachedAt < ttlMs && cacheKey === cachedKey) {
		return cachedOwners;
	}

	const owners = new Set(defaultOwners);
	if (kvStore && typeof kvStore.get === "function") {
		try {
			const raw = await kvStore.get(kvKey);
			for (const owner of parseOwners(raw)) {
				owners.add(owner);
			}
		} catch {
			// ignore
		}
	}

	cachedOwners = owners;
	cachedAt = now;
	cachedKey = cacheKey;
	return owners;
}
