import test from 'node:test';
import assert from 'node:assert/strict';
import { createReliabilityFixture } from '../src/server.mjs';

test('deduplicates a payment and exposes verification evidence', async t => {
  const fixture = createReliabilityFixture(); const port = await fixture.listen(); t.after(() => fixture.close());
  const request = { operationId: 'op-1', idempotencyKey: 'key-1', amount: 10 };
  const first = await fetch(`http://127.0.0.1:${port}/payments`, { method: 'POST', body: JSON.stringify(request) });
  const duplicate = await fetch(`http://127.0.0.1:${port}/payments`, { method: 'POST', body: JSON.stringify(request) });
  assert.deepEqual(await first.json(), await duplicate.json()); assert.equal(fixture.count(), 1);
  const verification = await fetch(`http://127.0.0.1:${port}/payments/key-1`); assert.equal(verification.status, 200);
});
test('can apply an effect and intentionally lose its response', async t => {
  const fixture = createReliabilityFixture(); const port = await fixture.listen(); t.after(() => fixture.close()); fixture.setMode('drop-after-apply');
  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/payments`, { method: 'POST', body: JSON.stringify({ operationId: 'op-2', idempotencyKey: 'key-2', amount: 10 }) }));
  assert.equal(fixture.count(), 1); fixture.setMode('normal');
  assert.equal((await fetch(`http://127.0.0.1:${port}/payments/key-2`)).status, 200);
});

test('accepts only documented fault controls and exposes retryable statuses', async t => {
  const fixture = createReliabilityFixture(); const port = await fixture.listen(); t.after(() => fixture.close());
  const admin = `http://127.0.0.1:${port}/admin/mode`;
  const invalid = await fetch(admin, { method: 'POST', body: JSON.stringify({ mode: 'boom' }) });
  assert.equal(invalid.status, 404);
  for (const mode of ['429', '503']) {
    const selected = await fetch(admin, { method: 'POST', body: JSON.stringify({ mode }) });
    assert.equal(selected.status, 200);
    const response = await fetch(`http://127.0.0.1:${port}/payments`, { method: 'POST', body: JSON.stringify({ operationId: `op-${mode}`, idempotencyKey: `key-${mode}`, amount: 10 }) });
    assert.equal(response.status, Number(mode));
    if (mode === '429') assert.equal(response.headers.get('retry-after'), '1');
  }
  assert.equal(fixture.count(), 0);
});
