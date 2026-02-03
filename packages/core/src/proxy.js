import { rawResponse, textResponse, withCors } from "./http.js";

// Exact path aliases.
export const DEFAULT_ALIAS_URLS = {};
// Prefix path aliases.
export const DEFAULT_PREFIX_URLS = {};

export function stripQuery(path) {
	return path.replace(/\?.*$/, "");
}

export function safeUrl(urlStr, base) {
	try {
		return base ? new URL(urlStr, base) : new URL(urlStr);
	} catch {
		return null;
	}
}

export function hasUserInfo(input) {
	const url = input instanceof URL ? input : safeUrl(String(input || ""));
	if (!url) return false;
	return Boolean(url.username);
}

export function getUserInfoToken(input) {
	const url = input instanceof URL ? input : safeUrl(String(input || ""));
	if (!url || !url.username) return "";
	if (url.password) return `${url.username}:${url.password}`;
	return url.username;
}

const DEFAULT_PROXY_UA = "gh-proxy";
const DEFAULT_HEADER_ALLOWLIST = [
	"accept",
	"range",
	"if-none-match",
	"if-modified-since",
];

export function buildProxyHeaders(
	req,
	{ userAgent, allowlist, reqHeaders } = {},
) {
	const headers = new Headers();
	const skip = new Set([
		"host",
		"connection",
		"keep-alive",
		"proxy-authenticate",
		"proxy-authorization",
		"te",
		"trailer",
		"transfer-encoding",
		"upgrade",
		"content-length",
	]);
	if (Array.isArray(allowlist) && allowlist.length) {
		for (const name of allowlist) {
			const key = name.toLowerCase();
			if (skip.has(key)) continue;
			const value = req.headers.get(key);
			if (value) headers.set(name, value);
		}
	} else {
		for (const [key, value] of req.headers.entries()) {
			if (skip.has(key)) continue;
			headers.set(key, value);
		}
	}
	headers.set("user-agent", userAgent || DEFAULT_PROXY_UA);
	if (reqHeaders) {
		for (const [key, value] of Object.entries(reqHeaders)) {
			headers.set(key, value);
		}
	}
	return headers;
}

const PREFLIGHT_HEADERS = {
	"access-control-allow-methods":
		"GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS",
	"access-control-max-age": "1728000",
};

export function handleProxyRequest(
	request,
	{
		url,
		authToken = "",
		injectToken = false,
		token = "",
		reqHeaders,
		userAgent,
		allowlist = DEFAULT_HEADER_ALLOWLIST,
		resHeaders,
	} = {},
) {
	if (
		request.method === "OPTIONS" &&
		request.headers.has("access-control-request-headers")
	) {
		return new Response(null, {
			status: 204,
			headers: withCors(PREFLIGHT_HEADERS),
		});
	}

	const reqHdrRaw = request.headers;
	const headers = buildProxyHeaders(request, {
		userAgent,
		allowlist,
		reqHeaders,
	});
	const tokenFromUrl = getUserInfoToken(url);
	if (tokenFromUrl) headers.set("authorization", `Bearer ${tokenFromUrl}`);
	if (!reqHdrRaw.has("authorization") && authToken) {
		headers.set("authorization", `Bearer ${authToken}`);
	}

	const urlStr = url instanceof URL ? url.toString() : String(url || "");
	const urlObj = url instanceof URL ? url : safeUrl(urlStr);

	return proxyRequest({
		request,
		url: urlObj,
		headers,
		injectToken,
		token,
		resHeaders,
		tweakPathname: urlObj?.pathname || "",
		onUpstreamError: (res) =>
			textResponse(
				res.status === 404 ? "Not Found" : "Upstream Error",
				res.status,
				resHeaders,
			),
	});
}

export function tweakProxyHeaders(hdrs, pathname) {
	const ext = pathname.split(".").pop();
	if (ext === "js")
		hdrs.set("content-type", "application/javascript; charset=utf-8");
	else if (ext === "cmd") hdrs.set("content-disposition", "attachment;");

	[
		["access-control-expose-headers", "*"],
		["access-control-allow-origin", "*"],
	].forEach(([k, v]) => {
		hdrs.set(k, v);
	});

	[
		"content-security-policy",
		"content-security-policy-report-only",
		"clear-site-data",
	].forEach((k) => {
		hdrs.delete(k);
	});
}

export async function finalizeProxyResponse(
	res,
	{
		headers,
		tweakPathname = "",
		injectToken = false,
		token = "",
		resHeaders,
		stripBody = false,
	} = {},
) {
	const resHdrNew = headers ? new Headers(headers) : new Headers(res.headers);
	if (resHeaders) {
		Object.entries(resHeaders).forEach(([k, v]) => {
			resHdrNew.set(k, v);
		});
	}
	if (tweakPathname) {
		tweakProxyHeaders(resHdrNew, tweakPathname);
	}
	if (stripBody) {
		return rawResponse(null, res.status, resHdrNew);
	}
	return rawResponse(res.body, res.status, resHdrNew);
}

export async function proxyRequest({
	request,
	url,
	headers,
	injectToken = false,
	token = "",
	resHeaders,
	tweakPathname = "",
	onUpstreamError,
	redirectsLeft = 3,
} = {}) {
	const urlObj = url instanceof URL ? url : safeUrl(String(url || ""));
	if (!urlObj) return textResponse("bad url", 502);
	const isHead = request.method === "HEAD";
	const reqInit = {
		method: isHead ? "GET" : request.method,
		headers,
		redirect: "manual",
		body: isHead ? undefined : request.body,
	};

	let res;
	try {
		res = await fetch(urlObj.href, reqInit);
	} catch (err) {
		return textResponse(`proxy fetch error: ${err.message}`, 502);
	}

	if (onUpstreamError && res.status >= 400) {
		return onUpstreamError(res);
	}

	const resHdrNew = new Headers(res.headers);
	if (
		resHdrNew.has("location") &&
		[301, 302, 303, 307, 308].includes(res.status)
	) {
		if (redirectsLeft <= 0) {
			return textResponse("too many redirects", 502);
		}
		const location = resHdrNew.get("location");
		const nextUrl = safeUrl(location, urlObj);
		if (!nextUrl) return textResponse("bad redirect", 502);
		return proxyRequest({
			request,
			url: nextUrl,
			headers,
			injectToken,
			token,
			resHeaders,
			tweakPathname: nextUrl.pathname,
			onUpstreamError,
			redirectsLeft: redirectsLeft - 1,
		});
	}
	return finalizeProxyResponse(res, {
		headers: resHdrNew,
		tweakPathname,
		injectToken,
		token,
		resHeaders,
		stripBody: isHead,
	});
}

function applyTemplate(template, bases) {
	return template.replace(/\{(\w+)\}/g, (_, key) => bases?.[key] || "");
}

export function resolveAliasTarget(
	input,
	{ bases, aliasUrls, prefixUrls } = {},
) {
	if (!input) return input;
	const pathname = stripQuery(input);
	const aliases = aliasUrls || DEFAULT_ALIAS_URLS;
	if (aliases[pathname]) return applyTemplate(aliases[pathname], bases);
	const prefixes = prefixUrls || DEFAULT_PREFIX_URLS;
	for (const [prefix, template] of Object.entries(prefixes)) {
		if (pathname.startsWith(prefix)) {
			const rest = pathname.slice(prefix.length);
			return `${applyTemplate(template, bases)}/${rest}`;
		}
	}
	return input;
}
