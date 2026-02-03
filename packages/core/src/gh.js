export const BASES = {
  raw: 'https://raw.githubusercontent.com',
  api: 'https://api.github.com',
  gist: 'https://gist.githubusercontent.com',
  github: 'https://github.com'
};

function getBaseHosts(bases) {
  return {
    raw: new URL(bases.raw).host,
    api: new URL(bases.api).host,
    gist: new URL(bases.gist).host,
    github: new URL(bases.github).host
  };
}

function extractIdentity(kind, parts) {
  let owner = null;
  let repo = null;
  let gistId = null;
  if (kind === 'raw' || kind === 'github') {
    owner = parts[0] || null;
    repo = parts[1] || null;
    if (repo && repo.endsWith('.git')) {
      repo = repo.slice(0, -4);
    }
  } else if (kind === 'gist') {
    owner = parts[0] || null;
    gistId = parts[1] || null;
  } else if (kind === 'api') {
    const [root, ownerPart, repoPart] = parts;
    if (root === 'repos' || root === 'users' || root === 'orgs') {
      owner = ownerPart || null;
    }
    if (root === 'repos') {
      repo = repoPart || null;
    }
  }
  return { owner, repo, gistId };
}

export function isAllowedPath(kind, parts) {
  if (kind === 'raw') {
    return parts.length >= 4; // owner/repo/ref/path
  }
  if (kind === 'gist') {
    return parts.length >= 3 && parts[2] === 'raw';
  }
  if (kind === 'github') {
    if (parts.length < 3) return false; // owner/repo/...
    const rest = parts.slice(2);
    if (rest[0] === 'raw') return true;
    if (rest[0] === 'archive') return true;
    if (rest[0] === 'tarball' || rest[0] === 'zipball') return true;
    if (rest[0] === 'releases' && rest[1] === 'download') return true;
    if (rest[0] === 'info' && rest[1] === 'refs') return true;
    if (rest[0] === 'git-upload-pack') return true;
    return false;
  }
  if (kind === 'api') {
    return true;
  }
  return false;
}

function getHostKindMap(bases) {
  const hosts = getBaseHosts(bases);
  return {
    [hosts.raw]: 'raw',
    [hosts.api]: 'api',
    [hosts.gist]: 'gist',
    [hosts.github]: 'github'
  };
}

function tryParseUrl(urlStr) {
  try {
    return new URL(urlStr);
  } catch {
    return null;
  }
}

function parseInput(input, bases) {
  if (!input || typeof input !== 'string') {
    return { kind: null, pathParts: [], upstreamUrl: null };
  }

  const trimmed = input.trim();
  if (!trimmed) return { kind: null, pathParts: [], upstreamUrl: null };

  const cleaned = trimmed.replace(/^\/+/, '');
  const hostKinds = getHostKindMap(bases);

  let url = null;
  if (/^https?:\/\//i.test(cleaned)) {
    url = tryParseUrl(cleaned);
  } else {
    const host = cleaned.split('/')[0];
    if (hostKinds[host]) {
      url = tryParseUrl(`https://${cleaned}`);
    }
  }

  if (url) {
    const kind = hostKinds[url.host] || null;
    const pathParts = url.pathname.split('/').filter(Boolean);
    return { kind, pathParts, upstreamUrl: url.href };
  }

  const pathParts = cleaned.split('/').filter(Boolean);
  if (!pathParts.length) return { kind: null, pathParts: [], upstreamUrl: null };

  const first = pathParts[0];
  if (bases?.[first]) {
    return { kind: first, pathParts: pathParts.slice(1), upstreamUrl: null };
  }

  return { kind: 'github', pathParts, upstreamUrl: null };
}

export function getKindAndPathParts(input, bases = BASES) {
  const { kind, pathParts } = parseInput(input, bases);
  return { kind, pathParts };
}

export function isGitPath(parts = []) {
  if (!Array.isArray(parts) || parts.length < 3) return false;
  const rest = parts.slice(2);
  if (rest[0] === 'info' && rest[1] === 'refs') return true;
  if (rest[0] === 'git-upload-pack') return true;
  return false;
}

export function parseTarget(input, bases = BASES) {
  const { kind, pathParts, upstreamUrl: parsedUrl } = parseInput(input, bases);
  const base = kind && bases[kind] ? bases[kind] : null;
  const identity = kind ? extractIdentity(kind, pathParts) : {};
  const owner = identity.owner || null;
  const repo = identity.repo || null;
  const gistId = identity.gistId || null;
  let upstreamUrl = parsedUrl;
  if (!upstreamUrl && base && pathParts.length) {
    upstreamUrl = `${base}/${pathParts.join('/')}`;
  }
  return { kind, pathParts, base, owner, repo, gistId, upstreamUrl };
}
