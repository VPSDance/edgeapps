import test from 'node:test';
import assert from 'node:assert/strict';

import { listKvKeys, normalizeKvKeys } from '../src/kv.js';

test('normalizeKvKeys supports multiple key field names', () => {
  const out = normalizeKvKeys({
    keys: [
      { name: 'a' },
      { key: 'b' },
      { Key: 'c' },
      { id: 'd' },
      'e',
      null
    ]
  });
  assert.deepEqual(out, ['a', 'b', 'c', 'd', 'e']);
});

test('normalizeKvKeys supports objects fallback field', () => {
  const out = normalizeKvKeys({
    objects: [
      { name: 'o1' },
      { key: 'o2' },
      { Key: 'o3' },
      { id: 'o4' },
      'o5'
    ]
  });
  assert.deepEqual(out, ['o1', 'o2', 'o3', 'o4', 'o5']);
});

test('listKvKeys paginates with cursor and complete fields', async () => {
  const calls = [];
  const kv = {
    async list(opts) {
      calls.push(opts);
      if (!opts.cursor) {
        return {
          keys: [{ name: 'k1' }, { key: 'k2' }],
          cursor: 'next-1',
          complete: false
        };
      }
      return {
        keys: [{ Key: 'k3' }, { id: 'k4' }],
        cursor: '',
        complete: true
      };
    }
  };

  const keys = await listKvKeys(kv, { prefix: 'link:', pageLimit: 256, maxPages: 10 });
  assert.deepEqual(keys, ['k1', 'k2', 'k3', 'k4']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].prefix, 'link:');
  assert.equal(calls[0].limit, 256);
  assert.equal(calls[1].cursor, 'next-1');
});

test('listKvKeys deduplicates keys across pages', async () => {
  const kv = {
    async list(opts) {
      if (!opts.cursor) {
        return {
          keys: [{ name: 'k1' }, { name: 'k2' }],
          cursor: 'next',
          list_complete: false
        };
      }
      return {
        keys: [{ name: 'k2' }, { name: 'k3' }],
        list_complete: true
      };
    }
  };

  const keys = await listKvKeys(kv, { maxPages: 4 });
  assert.deepEqual(keys, ['k1', 'k2', 'k3']);
});
