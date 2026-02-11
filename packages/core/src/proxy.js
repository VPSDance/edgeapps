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

function joinPathWithQuery(urlObj) {
	if (!urlObj) return "";
	return `${urlObj.pathname || ""}${urlObj.search || ""}${urlObj.hash || ""}`;
}

function getBaseHost(baseUrl) {
	const urlObj = safeUrl(baseUrl || "");
	return urlObj ? urlObj.host : "";
}

export function rewriteRedirectLocation(location, { requestUrl, currentUrl, bases } = {}) {
	const reqUrl = requestUrl instanceof URL ? requestUrl : safeUrl(String(requestUrl || ""));
	if (!reqUrl) return "";
	const nextUrl =
		location instanceof URL
			? location
			: safeUrl(String(location || ""), currentUrl instanceof URL ? currentUrl : undefined);
	if (!nextUrl) return "";

	const githubHost = getBaseHost(bases?.github);
	const rawHost = getBaseHost(bases?.raw);
	const apiHost = getBaseHost(bases?.api);
	const gistHost = getBaseHost(bases?.gist);
	const suffix = joinPathWithQuery(nextUrl);

	if (nextUrl.host === githubHost) return `${reqUrl.origin}${suffix}`;
	if (nextUrl.host === rawHost) return `${reqUrl.origin}/raw${suffix}`;
	if (nextUrl.host === apiHost) return `${reqUrl.origin}/api${suffix}`;
	if (nextUrl.host === gistHost) return `${reqUrl.origin}/gist${suffix}`;
	return nextUrl.href;
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

function toBase64(value) {
	if (typeof btoa === "function") return btoa(value);
	if (typeof Buffer !== "undefined") {
		return Buffer.from(value, "utf-8").toString("base64");
	}
	return "";
}

function buildAuthHeader(token, scheme) {
	if (!token) return "";
	if (scheme === "basic") {
		const raw = token.includes(":") ? token : `x-access-token:${token}`;
		const encoded = toBase64(raw);
		return encoded ? `Basic ${encoded}` : "";
	}
	return `Bearer ${token}`;
}

const DEFAULT_PROXY_UA = "gh-proxy";
export const DEFAULT_HEADER_ALLOWLIST = [
	"accept",
	"range",
	"if-none-match",
	"if-modified-since",
];
export const GIT_HEADER_ALLOWLIST = [
	...DEFAULT_HEADER_ALLOWLIST,
	// Git smart HTTP POST may be gzip; keep encoding/length headers.
	"authorization",
	"content-encoding",
	"content-type",
	"content-length",
	"git-protocol",
	"accept-encoding",
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
	const allowContentLength =
		Array.isArray(allowlist) &&
		allowlist.some((name) => name.toLowerCase() === "content-length");
	if (allowContentLength) skip.delete("content-length");
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
		bases,
		authToken = "",
		authScheme = "bearer",
		ignoreAuthHeader = false,
		injectToken = false,
		token = "",
		returnRedirect = false,
		rewriteRedirectToProxy = false,
		reqHeaders,
		userAgent,
		allowlist = DEFAULT_HEADER_ALLOWLIST,
		resHeaders,
		onUpstreamError,
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
	const hasAuthHeader = ignoreAuthHeader ? false : reqHdrRaw.has("authorization");
	if (!hasAuthHeader && tokenFromUrl) {
		const rawToken =
			authScheme === "basic" && !tokenFromUrl.includes(":")
				? `${tokenFromUrl}:`
				: tokenFromUrl;
		headers.set("authorization", buildAuthHeader(rawToken, authScheme));
	}
	if (!hasAuthHeader && !tokenFromUrl && authToken) {
		headers.set("authorization", buildAuthHeader(authToken, authScheme));
	}

	const urlStr = url instanceof URL ? url.toString() : String(url || "");
	const urlObj = url instanceof URL ? url : safeUrl(urlStr);
	const defaultOnUpstreamError = (res) =>
		textResponse(
			res.status === 404 ? "Not Found" : "Upstream Error",
			res.status,
			resHeaders,
		);
	const upstreamErrorHandler =
		onUpstreamError === undefined ? defaultOnUpstreamError : onUpstreamError;

	return proxyRequest({
		request,
		url: urlObj,
		bases,
		headers,
		injectToken,
		token,
		returnRedirect,
		rewriteRedirectToProxy,
		resHeaders,
		tweakPathname: urlObj?.pathname || "",
		onUpstreamError: upstreamErrorHandler,
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
		"x-proxy-upstream",
		"x-proxy-final-url",
		"x-proxy-status",
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
	bases,
	headers,
	injectToken = false,
	token = "",
	returnRedirect = false,
	rewriteRedirectToProxy = false,
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
		if (returnRedirect) {
			let nextLocation = nextUrl.href;
			if (rewriteRedirectToProxy) {
				nextLocation = rewriteRedirectLocation(nextUrl, {
					requestUrl: request?.url,
					currentUrl: urlObj,
					bases,
				});
				if (!nextLocation) return textResponse("bad redirect", 502);
			}
			resHdrNew.set("location", nextLocation);
			return finalizeProxyResponse(res, {
				headers: resHdrNew,
				tweakPathname,
				injectToken,
				token,
				resHeaders,
				stripBody: isHead,
			});
		}
		return proxyRequest({
			request,
			url: nextUrl,
			bases,
			headers,
			injectToken,
			token,
			returnRedirect,
			rewriteRedirectToProxy,
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
