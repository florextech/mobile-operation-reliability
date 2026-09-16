import test from 'node:test';
import assert from 'node:assert/strict';
import { operationId, proposeAcceptance, sameIntent, snapshotJson, assertOperationInvariants, DomainError } from '../dist/index.js';
import { input, limits, accepted, claim } from './helpers.mjs';

const invalid = fn => assert.throws(fn, error => error instanceof DomainError);

test('acceptance is a frozen transaction proposal, with initial event and no receipt', () => {
  const original = input();
  const proposal = proposeAcceptance(original, 1000, 'accept', limits);
  assert.equal(proposal.expectedRevision, null);
  assert.equal(proposal.operation.status, 'ACCEPTED');
  assert.equal(proposal.operation.executionCount, 0);
  assert.equal(proposal.event.from, null);
  assert.equal(proposal.event.revision, 0);
  assert.equal(proposal.kind, undefined);
  original.payload.amount = 999;
  original.policySnapshot.execution.maxAttempts = 999;
  assert.equal(proposal.operation.payload.amount, 10);
  assert.equal(proposal.operation.policySnapshot.execution.maxAttempts, 3);
  assert.throws(() => { proposal.operation.payload.amount = 99; }, TypeError);
  assert.throws(() => { proposal.operation.policySnapshot.execution.maxAttempts = 99; }, TypeError);
  assert.throws(() => { proposal.operation.status = 'COMPLETED'; }, TypeError);
  assertOperationInvariants(proposal.operation);
});

for (const field of ['id', 'type', 'definitionVersion', 'principalScope', 'targetScope', 'idempotencyKey']) {
  test(`rejects blank ${field}`, () => invalid(() => proposeAcceptance(input({ [field]: ' ' }), 0, 'm', limits)));
}
test('OperationId validates strings without generating runtime identity', () => {
  assert.equal(operationId('app-generated-id'), 'app-generated-id');
  invalid(() => operationId(''));
  invalid(() => operationId(4));
});

test('canonical intent equality ignores key insertion order and includes immutable policy/scope', () => {
  const a = input({ payload: { a: 1, b: { x: 2, y: 3 } } });
  const b = input({ payload: { b: { y: 3, x: 2 }, a: 1 } });
  assert.equal(sameIntent(a, b), true);
  for (const patch of [{ id: operationId('other') }, { definitionVersion: '2' }, { principalScope: 'other' }, { targetScope: 'staging' }, { idempotencyKey: 'key' }, { payload: [1, 2] }]) {
    assert.equal(sameIntent(a, { ...b, ...patch }), false);
  }
  b.policySnapshot.execution.maxAttempts++;
  assert.equal(sameIntent(a, b), false);
});

for (const value of [undefined, NaN, Infinity, 1n, () => 1, new Date(0), new Map(), [undefined], { x: undefined }, new Array(2)]) {
  test(`rejects non-JSON payload ${String(value)}`, () => invalid(() => snapshotJson(value, limits)));
}
test('rejects cycles, accessors, hidden/symbol keys without invoking getters', () => {
  const cycle = {}; cycle.self = cycle;
  let invoked = false;
  const getter = { get x() { invoked = true; return 1; } };
  for (const value of [cycle, getter, { [Symbol('key')]: 1 }, Object.defineProperty({}, 'x', { value: 1 })]) invalid(() => snapshotJson(value, limits));
  assert.equal(invoked, false);
});
test('JSON snapshots preserve prototype-looking keys and allow shared acyclic references', () => {
  const value = JSON.parse('{"__proto__":{"safe":true},"constructor":1}');
  const snapshot = snapshotJson(value, limits);
  assert.equal(Object.hasOwn(snapshot, '__proto__'), true);
  assert.equal(snapshot.__proto__.safe, true);
  const shared = { a: 1 };
  assert.deepEqual(snapshotJson([shared, shared], limits), [{ a: 1 }, { a: 1 }]);
});
test('enforces JSON UTF-8 bytes, nesting, timestamp and mutation ID boundaries', () => {
  assert.equal(snapshotJson('💵', { maxBytes: 6, maxDepth: 1 }), '💵');
  invalid(() => snapshotJson('💵', { maxBytes: 5, maxDepth: 1 }));
  invalid(() => snapshotJson({ a: { b: 1 } }, { maxBytes: 100, maxDepth: 1 }));
  invalid(() => proposeAcceptance(input(), Infinity, 'm', limits));
  invalid(() => proposeAcceptance(input(), 0, '', limits));
});
test('invariants reject incomplete ownership, inconsistent uncertainty, terminal data and counters', () => {
  const op = accepted();
  const active = claim(op);
  for (const corrupt of [
    { ...op, status: 'BOGUS' }, { ...op, unresolvedEffect: true },
    { ...op, lease: { ownerId: 'w', fence: 1, expiresAt: 10 } },
    { ...active, activeAttempt: null }, { ...active, lease: null },
    { ...active, lease: { ...active.lease, fence: 999 } },
    { ...op, completion: {} }, { ...op, failure: {} }, { ...op, executionCount: 4 },
    { ...op, firstExecutionAt: 1 }, { ...op, revision: -1 },
    { ...active, activeAttempt: { ...active.activeAttempt, kind: 'verification' } },
  ]) invalid(() => assertOperationInvariants(corrupt));
});

test('canonical identity ordering is locale-independent for Unicode, numeric and case-sensitive keys', async () => {
  const { canonicalJson } = await import('../dist/index.js');
  const values = { 'é': 1, z: 2, A: 3, a: 4, '10': 5, '2': 6, '💵': 7 };
  assert.equal(canonicalJson(values), '{"10":5,"2":6,"A":3,"a":4,"z":2,"é":1,"💵":7}');
  assert.equal(canonicalJson(Object.fromEntries(Object.entries(values).reverse())), canonicalJson(values));
});
