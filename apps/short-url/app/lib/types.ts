// Type definitions for Short URL service

export interface LinkData {
  code: string;
  url: string;
  tags: string[] | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLinkInput {
  url: string;
  code?: string;
  tags?: string[];
  note?: string;
}

export interface UpdateLinkInput {
  url?: string;
  code?: string;
  tags?: string[];
  note?: string;
}

/**
 * Generate a random short code
 */
export function generateCode(length: number = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let result = "";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

/**
 * Parse tags JSON string from DB into string array.
 */
export function parseTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  } catch {
    return [];
  }
}

/**
 * Serialize tags for DB storage.
 */
export function stringifyTags(tags: string[] | null | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  const cleaned = tags
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (cleaned.length === 0) return null;
  return JSON.stringify(cleaned);
}
