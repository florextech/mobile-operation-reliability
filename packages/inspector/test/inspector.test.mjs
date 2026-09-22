import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeAcceptance } from '@florexlabs/mor';
import { OperationInspector, redact } from '../dist/index.js';
import { input, limits } from '../../core/test/helpers.mjs';

test('redaction removes secrets without mutating visible payload data', () => {
  assert.deepEqual(redact({ token: 'no', nested: { apiKey: 'no', value: 2 } }), { token: '[REDACTED]', nested: { apiKey: '[REDACTED]', value: 2 } });
});
test('detail assembles the durable event timeline through pages', async () => {
  const operation = proposeAcceptance(input({ payload: { token: 'secret', amount: 4 } }), 1, 'm', limits).operation;
  const event = { operationId: operation.id, revision: 0, mutationId: 'm', from: null, to: 'ACCEPTED', occurredAt: 1, trigger: 'ACCEPT', attemptId: null };
  const repository = { list: async () => ({ kind: 'OK', value: { items: [operation], nextCursor: null } }), get: async () => ({ kind: 'OK', value: operation }), readEvents: async (_key, page) => ({ kind: 'OK', value: page.cursor === null ? { items: [event], nextCursor: '0' } : { items: [], nextCursor: null } }) };
  const detail = await new OperationInspector(repository).detail(operation);
  assert.equal(detail.kind, 'OK'); assert.deepEqual(detail.value.payload, { amount: 4, token: '[REDACTED]' }); assert.equal(detail.value.events.length, 1);
});

test('inspector passes principal and target scopes to an inventory query', async () => {
  let seen;
  const repository = { list: async query => { seen = query; return { kind: 'OK', value: { items: [], nextCursor: null } }; }, get: async () => ({ kind: 'OK', value: null }), readEvents: async () => ({ kind: 'OK', value: { items: [], nextCursor: null } }) };
  const result = await new OperationInspector(repository).list({ principalScope: 'tenant-a', targetScope: 'device-a', cursor: null, limit: 10 });
  assert.equal(result.kind, 'OK');
  assert.deepEqual(seen, { principalScope: 'tenant-a', targetScope: 'device-a', cursor: null, limit: 10 });
});
