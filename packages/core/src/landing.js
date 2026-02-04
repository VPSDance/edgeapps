export async function renderLanding(env, { defaultHtml = '<a href="https://github.com/VPSDance/edgeapps">VPSDance/edgeapps</a>' } = {}) {
  const html = env?.LANDING_HTML || defaultHtml;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=UTF-8' }
  });
}
