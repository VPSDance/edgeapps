import { BASES, isAllowedPath, parseTarget } from './gh.js';
import { DEFAULT_OWNERS, loadAllowedOwners, resolveOwners } from './owners.js';

export async function authorizeTarget(
  input,
  {
    env,
    bases = BASES,
    defaultOwners = DEFAULT_OWNERS,
    ttlMs,
    kvKey
  } = {}
) {
  const target = parseTarget(input, bases);
  if (!target.kind || !target.base) {
    return { ok: false, reason: 'kind' };
  }
  if (!isAllowedPath(target.kind, target.pathParts)) {
    return { ok: false, reason: 'path', kind: target.kind, pathParts: target.pathParts };
  }

  const resolvedOwners = resolveOwners(env, defaultOwners);
  const allowedOwners = await loadAllowedOwners({
    env,
    defaultOwners: resolvedOwners,
    ttlMs,
    kvKey
  });
  if (!target.owner) {
    return { ok: false, reason: 'owner', kind: target.kind, pathParts: target.pathParts };
  }
  if (allowedOwners.has('*')) {
    return {
      ok: true,
      kind: target.kind,
      pathParts: target.pathParts,
      owner: target.owner,
      base: target.base,
      upstreamUrl: target.upstreamUrl
    };
  }
  if (allowedOwners.size === 0) {
    return {
      ok: false,
      reason: 'owners',
      kind: target.kind,
      pathParts: target.pathParts,
      owner: target.owner
    };
  }
  const { repo, gistId } = target;
  const entries = new Set();
  if (target.owner) entries.add(target.owner);
  if (repo && target.owner) entries.add(`${target.owner}/${repo}`);
  if (gistId && target.owner) entries.add(`${target.owner}/${gistId}`);
  const allowed = [...entries].some((entry) => allowedOwners.has(entry));
  if (!allowed) {
    return {
      ok: false,
      reason: 'owners',
      kind: target.kind,
      pathParts: target.pathParts,
      owner: target.owner,
      repo,
      gistId
    };
  }

  return {
    ok: true,
    kind: target.kind,
    pathParts: target.pathParts,
    owner: target.owner,
    base: target.base,
    upstreamUrl: target.upstreamUrl
  };
}
