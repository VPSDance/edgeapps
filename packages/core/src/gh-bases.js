import { BASES } from './gh.js';

export function buildGhBases() {
  const raw = BASES.raw;
  const api = BASES.api;
  const gist = BASES.gist;
  const github = BASES.github;
  return { raw, api, gist, github };
}
