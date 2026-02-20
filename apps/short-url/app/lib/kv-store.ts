// KV Storage Adapter for Short URL service (Simplified)
// - Links stored with tags as JSON field (no separate tag index)
// - Compatible with Cloudflare KV and EdgeOne KV

import { listKvKeys } from '@edgeapps/core/kv';
import type { LinkData, CreateLinkInput, UpdateLinkInput } from './types';
import { generateCode } from './types';

// KV key prefix
const LINK_PREFIX = 'link:';
const KV_LIST_PAGE_LIMIT = 256;
const KV_LIST_MAX_PAGES = 40;

export interface KVStore {
  get(key: string, options?: { type?: 'text' | 'json' }): Promise<any>;
  put(key: string, value: string, options?: { metadata?: any }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<unknown>;
}

// Stored data structure in KV
interface KVLinkData {
  url: string;
  tags?: string[];
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get a link by code
 */
export async function getLink(kv: KVStore, code: string): Promise<LinkData | null> {
  const data = (await kv.get(`${LINK_PREFIX}${code}`, { type: 'json' })) as
    | KVLinkData
    | null;
  if (!data) return null;
  return {
    code,
    url: data.url,
    tags: data.tags || null,
    note: data.note || null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  };
}

/**
 * Get link URL only (fast path for redirect)
 */
export async function getLinkUrl(kv: KVStore, code: string): Promise<string | null> {
  const data = (await kv.get(`${LINK_PREFIX}${code}`, { type: 'json' })) as
    | KVLinkData
    | null;
  return data?.url || null;
}

/**
 * Create a new short link
 */
export async function createLink(
  kv: KVStore,
  input: CreateLinkInput,
  codeLength: number = 6
): Promise<LinkData> {
  const code = input.code || generateCode(codeLength);
  const now = new Date().toISOString();

  // Check if code already exists
  const existing = await getLink(kv, code);
  if (existing) {
    throw new Error('UNIQUE constraint: Short code already exists');
  }

  const kvData: KVLinkData = {
    url: input.url,
    tags: input.tags?.length ? input.tags : undefined,
    note: input.note || undefined,
    createdAt: now,
    updatedAt: now
  };

  await kv.put(`${LINK_PREFIX}${code}`, JSON.stringify(kvData));

  return {
    code,
    url: kvData.url,
    tags: kvData.tags || null,
    note: kvData.note || null,
    createdAt: kvData.createdAt,
    updatedAt: kvData.updatedAt
  };
}

/**
 * Update an existing link
 */
export async function updateLink(
  kv: KVStore,
  code: string,
  input: UpdateLinkInput
): Promise<LinkData | null> {
  const existing = await getLink(kv, code);
  if (!existing) return null;

  const now = new Date().toISOString();
  const newCode = input.code || code;

  // If code is changing, check uniqueness
  if (input.code && input.code !== code) {
    const conflict = await getLink(kv, input.code);
    if (conflict) {
      throw new Error('UNIQUE constraint: Short code already exists');
    }
    // Delete old entry
    await kv.delete(`${LINK_PREFIX}${code}`);
  }

  const kvData: KVLinkData = {
    url: input.url ?? existing.url,
    tags: (input.tags ?? existing.tags) || undefined,
    note: (input.note ?? existing.note) || undefined,
    createdAt: existing.createdAt,
    updatedAt: now
  };

  await kv.put(`${LINK_PREFIX}${newCode}`, JSON.stringify(kvData));

  return {
    code: newCode,
    url: kvData.url,
    tags: kvData.tags || null,
    note: kvData.note || null,
    createdAt: kvData.createdAt,
    updatedAt: kvData.updatedAt
  };
}

/**
 * Delete a link
 */
export async function deleteLink(kv: KVStore, code: string): Promise<boolean> {
  const existing = await getLink(kv, code);
  if (!existing) return false;
  await kv.delete(`${LINK_PREFIX}${code}`);
  return true;
}

/**
 * List all links with optional search and tag filter
 * Note: For KV, we fetch all and filter client-side
 */
export async function listLinks(
  kv: KVStore,
  options?: { search?: string; tag?: string; limit?: number }
): Promise<{ links: LinkData[]; total: number }> {
  const limit = options?.limit ?? 100;

  // List all keys via core pagination helper to support CF/EdgeOne differences.
  const keys = await listKvKeys(kv, {
    prefix: LINK_PREFIX,
    pageLimit: KV_LIST_PAGE_LIMIT,
    maxPages: KV_LIST_MAX_PAGES
  });
  const codes = keys
    .filter((key) => key.startsWith(LINK_PREFIX))
    .map((key) => key.slice(LINK_PREFIX.length));

  // Fetch all links in parallel
  const links = await Promise.all(
    codes.map(async (code) => {
      return getLink(kv, code);
    })
  );

  // Filter out nulls and apply filters
  let results = links.filter((l): l is LinkData => l !== null);

  // Sort by updatedAt descending
  results.sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  // Apply search filter
  if (options?.search) {
    const s = options.search.toLowerCase();
    results = results.filter(
      (link) =>
        link.code.toLowerCase().includes(s) ||
        link.url.toLowerCase().includes(s) ||
        link.note?.toLowerCase().includes(s)
    );
  }

  // Apply tag filter
  if (options?.tag) {
    results = results.filter((link) => link.tags?.includes(options.tag!));
  }

  // Apply limit
  const total = results.length;
  results = results.slice(0, limit);

  return { links: results, total };
}

/**
 * Get all unique tags from all links
 */
export async function getAllTags(kv: KVStore): Promise<string[]> {
  const { links } = await listLinks(kv, { limit: 1000 });

  const tagSet = new Set<string>();
  for (const link of links) {
    if (link.tags) {
      link.tags.forEach((t) => tagSet.add(t));
    }
  }

  return Array.from(tagSet).sort();
}
