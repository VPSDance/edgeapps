export function withCors(extra = {}) {
  return { 'access-control-allow-origin': '*', ...extra };
}

export function unauthorized(realm, extraHeaders = {}) {
  return textResponse('Auth required', 401, {
    'WWW-Authenticate': `Basic realm="${realm}"`,
    ...extraHeaders
  });
}

export function forbidden(extraHeaders = {}) {
  return textResponse('Forbidden', 403, extraHeaders);
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ 'content-type': 'application/json; charset=utf-8' })
  });
}

export function textResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: withCors({ 'content-type': 'text/plain; charset=UTF-8', ...headers })
  });
}

export function rawResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers });
}
