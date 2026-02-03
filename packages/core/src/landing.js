export async function renderLanding(env, { defaultHtml = '<a></a>' } = {}) {
  const html = env?.LANDING_HTML || defaultHtml;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=UTF-8' }
  });
}
