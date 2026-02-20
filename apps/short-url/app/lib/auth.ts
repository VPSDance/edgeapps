// Basic Auth helper functions

/**
 * Check if request has valid Basic Auth credentials
 */
export function checkBasicAuth(request: Request, adminAuth: string): boolean {
  if (!adminAuth) return false;

  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Basic ")) return false;

  try {
    const decoded = atob(auth.slice(6));
    return decoded === adminAuth;
  } catch {
    return false;
  }
}

/**
 * Create a 401 Unauthorized response with WWW-Authenticate header
 */
export function unauthorized(realm: string = "Short URL Admin"): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${realm}"`,
      "Content-Type": "text/plain",
    },
  });
}

/**
 * Get client IP from request headers (Cloudflare specific)
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Real-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ||
    "unknown"
  );
}
