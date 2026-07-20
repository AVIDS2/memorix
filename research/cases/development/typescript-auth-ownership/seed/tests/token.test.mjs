import assert from 'node:assert/strict';
import test from 'node:test';

import { createSession } from '../src/session.js';

test('accepts a sufficiently long token', () => {
  assert.deepEqual(createSession('abcdefgh'), { token: 'abcdefgh' });
});
test('rejects a short token', () => {
  assert.throws(() => createSession('short'));
});
