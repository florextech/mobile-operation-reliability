import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationAcceptanceError, OperationEngine, OperationScheduler, OperationTerminalError, transition } from '../dist/index.js';
import { FakeTransport } from '../dist/testing.js';
import { input, limits } from './helpers.mjs';

class MemoryStorage {
  constructor({ failAccept = false } = {}) { this.operations = new Map(); this.failAccept = failAccept; this.accepts = 0; }
  async accept(proposal) {
    this.accepts++;
    if (this.failAccept) return { kind: 'ERROR', error: { code: 'DISK', category: 'STORAGE', certainty: 'NOT_APPLICABLE', scope: 'LOCAL', action: 'HOLD', message: 'DISK' } };
    const old = this.operations.get(proposal.operation.id);
    if (old) return { kind: 'EXISTING', operation: old };
    this.operations.set(proposal.operation.id, proposal.operation);
    return { kind: 'COMMITTED', operation: proposal.operation, mutationId: proposal.mutationId };
  }
  async get(key) { return { kind: 'OK', value: this.operations.get(key.id) ?? null }; }
  async scanWork(query) {
    return { kind: 'OK', value: { items: [...this.operations.values()].filter(op => op.principalScope === query.principalScope && op.targetScope === query.targetScope && !['COMPLETED', 'FAILED'].includes(op.status)), nextCursor: null } };
  }
  async claim(request) { return this.mutate(request); }
  async commitTransition(request) { return this.mutate(request); }
  async mutate(request) {
    const operation = this.operations.get(request.key.id);
    try {
      const change = transition(operation, request.command, request.context);
      this.operations.set(operation.id, change.operation);
      return { kind: 'COMMITTED', operation: change.operation, mutationId: change.mutationId };
    } catch (error) { return { kind: 'CONFLICT', code: error.code === 'NotEligible' ? 'NotEligible' : 'RevisionConflict' }; }
  }
}

function createEngine(storage, transport, now = 1000, overrides = {}) {
  let serial = 0;
  return new OperationEngine({
    storage, transport, clock: { wallNow: () => now }, limits, leaseDurationMs: 1000,
    identifiers: { ownerId: 'worker', nextMutationId: () => `mutation-${++serial}`, nextAttemptId: () => `attempt-${serial}` },
    isDefinitionReady: () => true, areCredentialsReady: () => true, nextJitterSample: () => 0.5, ...overrides,
  });
}
function completed(context) {
  return { result: { kind: 'CONFIRMED_COMPLETED', evidence: { operationId: context.operation.id, attemptId: context.attemptId, source: 'BACKEND', scope: 'OPERATION', observedAt: 1000, code: 'OK' }, result: { remoteId: context.operation.id } } };
}

test('execute resolves after durable acceptance and before transport', async () => {
  const storage = new MemoryStorage();
  const transport = new FakeTransport(completed);
  const engine = createEngine(storage, transport);
  const handle = await engine.execute(input());
  assert.equal(handle.id, input().id);
  assert.equal(storage.accepts, 1);
  assert.equal(transport.calls.length, 0);
  assert.equal((await handle.status()).value.status, 'ACCEPTED');
});

test('scheduler claims durable work before online success and confirmed resolves', async () => {
  const storage = new MemoryStorage();
  const transport = new FakeTransport(completed);
  const engine = createEngine(storage, transport);
  const handle = await engine.execute(input());
  const waiting = handle.confirmed();
  const scheduler = new OperationScheduler(engine, { principalScope: 'account-1', targetScope: 'production' }, { scheduleWake: () => () => {} });
  await scheduler.run();
  const result = await waiting;
  assert.equal(result.status, 'COMPLETED');
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].operation.executionCount, 1);
});

test('transport exception records UNKNOWN without pretending failure', async () => {
  const storage = new MemoryStorage();
  const engine = createEngine(storage, new FakeTransport(async () => { throw new Error('connection lost'); }));
  const handle = await engine.execute(input());
  await engine.runOnce({ principalScope: 'account-1', targetScope: 'production' });
  const current = await handle.status();
  assert.equal(current.value.status, 'UNKNOWN');
  assert.equal(current.value.lastEvidence.code, 'TRANSPORT_EXCEPTION');
});

test('acceptance error never returns a handle or invokes transport', async () => {
  const storage = new MemoryStorage({ failAccept: true });
  const transport = new FakeTransport(completed);
  const engine = createEngine(storage, transport);
  await assert.rejects(() => engine.execute(input()), OperationAcceptanceError);
  assert.equal(transport.calls.length, 0);
});

test('confirmed rejects a terminal business failure', async () => {
  const storage = new MemoryStorage();
  const transport = new FakeTransport(context => ({ result: { kind: 'CONFIRMED_REJECTED', evidence: { operationId: context.operation.id, attemptId: context.attemptId, source: 'BACKEND', scope: 'OPERATION', observedAt: 1000, code: 'REJECTED' } } }));
  const engine = createEngine(storage, transport);
  const handle = await engine.execute(input());
  const waiting = handle.confirmed();
  await engine.runOnce({ principalScope: 'account-1', targetScope: 'production' });
  await assert.rejects(() => waiting, OperationTerminalError);
});

test('restart rehydrates an accepted operation and executes it once', async () => {
  const storage = new MemoryStorage();
  const first = createEngine(storage, new FakeTransport(completed));
  const handle = await first.execute(input());
  const secondTransport = new FakeTransport(completed);
  const second = createEngine(storage, secondTransport);
  await second.runOnce({ principalScope: 'account-1', targetScope: 'production' });
  assert.equal((await handle.status()).value.status, 'COMPLETED');
  assert.equal(secondTransport.calls.length, 1);
});

test('multiple accepted operations execute independently', async () => {
  const storage = new MemoryStorage();
  const transport = new FakeTransport(completed);
  const engine = createEngine(storage, transport);
  await engine.execute(input({ id: 'one' }));
  await engine.execute(input({ id: 'two' }));
  await engine.runOnce({ principalScope: 'account-1', targetScope: 'production' });
  assert.equal(transport.calls.length, 2);
  assert.equal((await storage.get(input({ id: 'one' }))).value.status, 'COMPLETED');
  assert.equal((await storage.get(input({ id: 'two' }))).value.status, 'COMPLETED');
});

test('retryable no-effect records the injected backoff and Retry-After durably', async () => {
  const storage = new MemoryStorage();
  const transport = new FakeTransport(context => ({ retryAfterAt: 5000, result: { kind: 'NOT_APPLIED', retryable: true, evidence: { operationId: context.operation.id, attemptId: context.attemptId, source: 'LOCAL', scope: 'ATTEMPT', observedAt: 1000, code: 'TEMPORARY' } } }));
  const engine = createEngine(storage, transport, 1000, { nextJitterSample: () => 1 });
  await engine.execute(input());
  await engine.runOnce({ principalScope: 'account-1', targetScope: 'production' });
  const operation = (await storage.get(input())).value;
  assert.equal(operation.status, 'ACCEPTED');
  assert.deepEqual(operation.schedule, { kind: 'execution', at: 5000 });
});

test('offline is a scheduling hint that prevents claims until the next online run', async () => {
  const storage = new MemoryStorage();
  const transport = new FakeTransport(completed);
  let state = 'offline';
  const network = { getSnapshot: () => state, subscribe: () => () => {} };
  const engine = createEngine(storage, transport, 1000, { network });
  await engine.execute(input());
  await engine.runOnce({ principalScope: 'account-1', targetScope: 'production' });
  assert.equal(transport.calls.length, 0);
  state = 'online';
  await engine.runOnce({ principalScope: 'account-1', targetScope: 'production' });
  assert.equal(transport.calls.length, 1);
});

test('scheduler runs again after a network reconnect without changing durable eligibility', async () => {
  const storage = new MemoryStorage();
  const transport = new FakeTransport(completed);
  let listener = null;
  let state = 'offline';
  const network = { getSnapshot: () => state, subscribe: callback => { listener = callback; return () => { listener = null; }; } };
  const engine = createEngine(storage, transport, 1000, { network });
  await engine.execute(input());
  const scheduler = new OperationScheduler(engine, { principalScope: 'account-1', targetScope: 'production' }, { scheduleWake: () => () => {} }, network);
  const stop = scheduler.start();
  state = 'online';
  listener('online');
  await scheduler.run();
  assert.equal(transport.calls.length, 1);
  stop();
});

test('restart keeps durable retry schedule and does not run early', async () => {
  const storage = new MemoryStorage();
  const retry = new FakeTransport(context => ({ result: { kind: 'NOT_APPLIED', retryable: true, evidence: { operationId: context.operation.id, attemptId: context.attemptId, source: 'LOCAL', scope: 'ATTEMPT', observedAt: 1000, code: 'TEMPORARY' } } }));
  const first = createEngine(storage, retry, 1000, { nextJitterSample: () => 1 });
  await first.execute(input());
  await first.runOnce({ principalScope: 'account-1', targetScope: 'production' });
  const earlyTransport = new FakeTransport(completed);
  await createEngine(storage, earlyTransport, 1009).runOnce({ principalScope: 'account-1', targetScope: 'production' });
  assert.equal(earlyTransport.calls.length, 0);
  const dueTransport = new FakeTransport(completed);
  await createEngine(storage, dueTransport, 1010).runOnce({ principalScope: 'account-1', targetScope: 'production' });
  assert.equal(dueTransport.calls.length, 1);
  assert.equal((await storage.get(input())).value.status, 'COMPLETED');
});
