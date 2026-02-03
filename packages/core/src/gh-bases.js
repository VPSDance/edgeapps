import { BASES } from './gh.js';

export function buildGhBases(token = '') {
  const raw = BASES.raw;
  const api = BASES.api;
  const gist = BASES.gist;
  const github = BASES.github;
  const praw = token ? `https://${token}@raw.githubusercontent.com` : raw;
  return { raw, api, gist, github, praw };
}
