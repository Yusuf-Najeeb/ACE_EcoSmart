import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../test-support/fixture.js';

test('Unavailable voice calls cannot create pretend connected sessions', async t => {
  const env = await fixture(t);
  const user = env.client('generator');
  for (const action of ['initiate', 'status', 'respond', 'end']) {
    assert.equal((await env.client().request('/api/call/' + action, {})).status, 401);
    const result = await user.request('/api/call/' + action, {});
    assert.equal(result.status, 503);
    assert.match(result.data.error, /chat/);
  }
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM call_sessions').get().n, 0);
});
