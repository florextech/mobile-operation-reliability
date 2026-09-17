import test from 'node:test';
import assert from 'node:assert/strict';
import { ChaosTransport } from '../dist/testing.js';

test('chaos transport consumes deterministic faults and preserves call context', async () => {
  const transport = new ChaosTransport([new Error('response lost'), { result: { kind: 'RETRYABLE_NO_EFFECT', evidence: { operationId: 'op', attemptId: 'a2', source: 'BACKEND', scope: 'ATTEMPT', observedAt: 1, code: '503' } } }]);
  const context = attemptId => ({ operation: { id: 'op' }, attemptId, deadlineAt: 2 });
  await assert.rejects(() => transport.execute(context('a1')), /response lost/);
  const result = await transport.execute(context('a2'));
  assert.equal(result.result.kind, 'RETRYABLE_NO_EFFECT');
  assert.deepEqual(transport.calls.map(call => call.attemptId), ['a1', 'a2']);
});
