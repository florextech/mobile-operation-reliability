import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRetryPolicy, nextRetryAt, isReplaySafe, proposeAcceptance } from '../dist/index.js';
import { policy, input, limits } from './helpers.mjs';

for (const [field, values] of Object.entries({ maxAttempts: [0, -1, 1.5, Infinity], timeoutMs: [0, -1, Infinity], baseDelayMs: [-1, NaN], maxDelayMs: [-1, Infinity] })) {
  for (const value of values) test(`invalid execution policy ${field}=${value}`, () => {
    assert.throws(() => validateRetryPolicy({ ...policy, execution: { ...policy.execution, [field]: value } }));
  });
}
test('verification can be disabled; backoff and replay configuration must be coherent', () => {
  validateRetryPolicy({ ...policy, verification: { ...policy.verification, maxAttempts: 0 } });
  assert.throws(() => validateRetryPolicy({ ...policy, execution: { ...policy.execution, baseDelayMs: 101 } }));
  for (const replay of [{ kind: 'INVALID' }, { kind: 'IDEMPOTENT', contractVersion: '' }, { kind: 'DEDUPLICATED', contractVersion: 'v1', retentionMs: 10, safetyMarginMs: 10 }]) {
    assert.throws(() => validateRetryPolicy({ ...policy, replay }));
  }
  assert.throws(() => proposeAcceptance(input({ policySnapshot: { ...policy, replay: { kind: 'DEDUPLICATED', contractVersion: 'v1', retentionMs: 100, safetyMarginMs: 1 } } }), 0, 'm', limits));
});
test('backoff is deterministic, bounded and jitter receives no global randomness', () => {
  assert.equal(nextRetryAt(policy.execution, 1, 100, 1), 110);
  assert.equal(nextRetryAt(policy.execution, 2, 100, 1), 120);
  assert.equal(nextRetryAt(policy.execution, 3, 100, .5), 120);
  assert.equal(nextRetryAt(policy.execution, 10000, 100, 1), 200);
  assert.equal(nextRetryAt(policy.execution, 1, 100, 0), 100);
  assert.equal(nextRetryAt({ ...policy.execution, baseDelayMs: 0 }, 10000, 100, 1), 100);
  assert.equal(nextRetryAt(policy.execution, 1, 100, 1, 1000), 1000);
  for (const sample of [-1, 1.01, NaN, Infinity]) assert.throws(() => nextRetryAt(policy.execution, 1, 100, sample));
  assert.throws(() => nextRetryAt(policy.execution, 0, 100, 1));
  assert.throws(() => nextRetryAt(policy.execution, 1, Number.MAX_SAFE_INTEGER, 1));
});
const guarantee = { kind: 'DEDUPLICATED', contractVersion: 'v1', retentionMs: 1000, safetyMarginMs: 100 };
const replayContext = { now: 1500, firstExecutionAt: 1000, idempotencyKey: 'key', contractVersion: 'v1', clockTrusted: true };
test('replay window is anchored to the first reservation and expires conservatively', () => {
  assert.equal(isReplaySafe(guarantee, replayContext), true);
  assert.equal(isReplaySafe(guarantee, { ...replayContext, now: 1899 }), true);
  for (const patch of [{ now: 1900 }, { now: 999 }, { clockTrusted: false }, { contractVersion: 'v2' }, { firstExecutionAt: null }, { idempotencyKey: null }]) assert.equal(isReplaySafe(guarantee, { ...replayContext, ...patch }), false);
});
test('replay safety is not inferred from identity or clock alone', () => {
  assert.equal(isReplaySafe({ kind: 'NONE' }, replayContext), false);
  assert.equal(isReplaySafe({ kind: 'IDEMPOTENT', contractVersion: 'v1' }, { ...replayContext, clockTrusted: false, idempotencyKey: null }), true);
  assert.equal(isReplaySafe({ kind: 'IDEMPOTENT', contractVersion: 'v2' }, replayContext), false);
});
test('bounded backoff properties over many attempts and samples', () => {
  for (let attempts = 1; attempts <= 200; attempts++) {
    let previous = 100;
    for (let i = 0; i <= 10; i++) {
      const at = nextRetryAt(policy.execution, attempts, 100, i / 10);
      assert.ok(Number.isSafeInteger(at) && at >= previous && at <= 200);
      previous = at;
    }
  }
});
