import test from 'node:test';
import assert from 'node:assert/strict';

import { isAllowedPath } from '../src/gh.js';

test('allows github releases/latest', () => {
  const parts = ['owner', 'repo', 'releases', 'latest'];
  assert.equal(isAllowedPath('github', parts), true);
});

test('keeps existing github releases/download rule', () => {
  const parts = ['owner', 'repo', 'releases', 'download', 'v1.0.0', 'asset.zip'];
  assert.equal(isAllowedPath('github', parts), true);
});

test('allows github releases/tag for rewritten latest redirects', () => {
  const parts = ['owner', 'repo', 'releases', 'tag', 'v1.0.0'];
  assert.equal(isAllowedPath('github', parts), true);
});
