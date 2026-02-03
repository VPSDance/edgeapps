const IP_HEADERS = [
  'eo-client-ip',
  'cf-connecting-ip',
  'x-forwarded-for'
];

function parseIp(value) {
  if (!value) return '';
  return value.split(',')[0].trim();
}

export function getClientIpInfo(req) {
  const eoClientIp = req?.eo?.clientIp;
  if (eoClientIp) return { ip: eoClientIp, source: 'eo.clientIp' };
  for (const name of IP_HEADERS) {
    const val = req.headers.get(name);
    const ip = parseIp(val);
    if (ip) return { ip, source: name };
  }
  return { ip: '0.0.0.0', source: 'none' };
}

export function getClientIp(req) {
  return getClientIpInfo(req).ip;
}
