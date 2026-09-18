import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeAcceptance } from '@florextech/core';
import { SQLiteOperationStore } from '../dist/index.js';
import { NodeSQLiteConnection } from '../dist/node.js';
import { input, limits, claimCommand, context, resultCommand } from '../../core/test/helpers.mjs';

async function setup(t, wrap = db => db) {
  const dir = mkdtempSync(join(tmpdir(), 'mor-sqlite-'));
  const path = join(dir, 'operations.db');
  const db = new NodeSQLiteConnection(path);
  let now = 1020;
  const clock = { wallNow: () => now };
  const store = new SQLiteOperationStore(wrap(db), clock, limits);
  t.after(async () => { await store.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await store.open(1)).kind, 'OK');
  const proposal = proposeAcceptance(input(), 1000, 'accept', limits);
  return { db, store, path, proposal, clock, time: n => { now = n; } };
}
function request(op, command, id = `change-${op.revision}`) { return { key: { id: op.id, principalScope: op.principalScope, targetScope: op.targetScope }, context: context(op, { mutationId: id }), command }; }

test('accept is durable, idempotent and scoped; reopen retains events and mutation', async t => {
  const { store, proposal, path, clock } = await setup(t);
  const first = await store.accept(proposal);
  assert.equal(first.kind, 'COMMITTED');
  assert.deepEqual(await store.accept(proposal), first);
  assert.equal((await store.accept({ ...proposal, mutationId: 'other' })).kind, 'ERROR');
  const another = proposeAcceptance(input(), 1000, 'another', limits);
  assert.equal((await store.accept(another)).kind, 'EXISTING');
  assert.equal((await store.get({ ...proposal.operation, principalScope: 'other' })).value, null);
  await store.close();
  const reopened = new SQLiteOperationStore(new NodeSQLiteConnection(path), clock, limits);
  t.after(() => reopened.close());
  assert.equal((await reopened.open(1)).kind, 'OK');
  assert.deepEqual((await reopened.get(proposal.operation)).value, first.operation);
  assert.deepEqual((await reopened.getMutation(proposal.operation, 'accept')).value, proposal);
  assert.equal((await reopened.readEvents(proposal.operation, { cursor: null, limit: 10 })).value.items.length, 1);
});

test('claim, renew, completion and historical mutation replay', async t => {
  const { store, proposal, time } = await setup(t);
  await store.accept(proposal);
  const claim = request(proposal.operation, claimCommand(proposal.operation));
  const claimed = await store.claim(claim);
  assert.equal(claimed.kind, 'COMMITTED');
  assert.equal(claimed.operation.status, 'EXECUTING');
  time(1040);
  const renewal = request(claimed.operation, { kind: 'RENEW', ownership: { ownerId: 'worker-A', fence: 1, attemptId: 'attempt-1' }, leaseDurationMs: 300 });
  const renewed = await store.renew(renewal);
  assert.equal(renewed.kind, 'COMMITTED');
  time(1060);
  const completed = await store.commitTransition(request(renewed.operation, resultCommand(renewed.operation)));
  assert.equal(completed.operation.status, 'COMPLETED');
  assert.deepEqual(await store.claim(claim), claimed);
  assert.equal((await store.claim({ ...claim, command: { ...claim.command, ownerId: 'B' } })).code, 'IdentityConflict');
  assert.equal((await store.scanWork({ ...proposal.operation, cursor: null, limit: 10 })).value.items.length, 0);
});

test('expired attempt recovers UNKNOWN and stale result cannot overwrite recovery', async t => {
  const { store, proposal, time } = await setup(t);
  await store.accept(proposal);
  const active = (await store.claim(request(proposal.operation, claimCommand(proposal.operation)))).operation;
  time(2000);
  const recovered = await store.recoverExpired(request(active, { kind: 'RECOVER_EXPIRED', jitterSample: 1 }));
  assert.equal(recovered.operation.status, 'UNKNOWN');
  const late = await store.commitTransition(request(active, resultCommand(active), 'late'));
  assert.equal(late.code, 'RevisionConflict');
  const scheduled = await store.updateScheduling(request(recovered.operation, { kind: 'SCHEDULE', schedule: null, holdReason: 'CREDENTIALS', jitterSample: 1 }));
  assert.equal(scheduled.operation.status, 'UNKNOWN');
  assert.equal(scheduled.operation.holdReason, 'CREDENTIALS');
});

test('identity and idempotency collisions fail without overwriting', async t => {
  const { store, proposal } = await setup(t);
  await store.accept(proposal);
  assert.equal((await store.accept(proposeAcceptance(input({ payload: { amount: 999 } }), 1000, 'new', limits))).code, 'IdentityConflict');
  const a = proposeAcceptance(input({ id: 'a', idempotencyKey: 'same' }), 1000, 'a', limits);
  const b = proposeAcceptance(input({ id: 'b', idempotencyKey: 'same' }), 1000, 'b', limits);
  assert.equal((await store.accept(a)).kind, 'COMMITTED');
  assert.equal((await store.accept(b)).code, 'IdentityConflict');
});

test('event failure rolls back aggregate and ledger atomically', async t => {
  const { store, proposal, db } = await setup(t, db => ({
    get inTransaction() { return db.inTransaction; }, exec: sql => db.exec(sql), get: (...a) => db.get(...a), all: (...a) => db.all(...a), close: () => db.close(),
    run(sql, params) { if (sql.startsWith('INSERT INTO operation_events')) throw new Error('fault'); return db.run(sql, params); },
  }));
  assert.equal((await store.accept(proposal)).kind, 'ERROR');
  assert.equal(db.get('SELECT count(*) AS n FROM operations').n, 0);
  assert.equal(db.get('SELECT count(*) AS n FROM operation_mutations').n, 0);
});

test('lost COMMIT acknowledgement returns INDETERMINATE and is reconcilable', async t => {
  let enabled = false;
  const { store, proposal } = await setup(t, db => ({
    get inTransaction() { return db.inTransaction; },
    exec(sql) { db.exec(sql); if (enabled && sql === 'COMMIT') throw new Error('lost ack'); },
    run: (...a) => db.run(...a), get: (...a) => db.get(...a), all: (...a) => db.all(...a), close: () => db.close(),
  }));
  enabled = true;
  assert.equal((await store.accept(proposal)).kind, 'INDETERMINATE');
  assert.deepEqual((await store.getMutation(proposal.operation, 'accept')).value, proposal);
  enabled = false;
  assert.equal((await store.accept(proposal)).kind, 'COMMITTED');
});

test('corrupt snapshot fails closed and remains present', async t => {
  const { db, store, proposal } = await setup(t);
  await store.accept(proposal);
  db.run('UPDATE operations SET snapshot=?', ['{}']);
  assert.equal((await store.get(proposal.operation)).kind, 'ERROR');
  assert.equal((await store.scanWork({ ...proposal.operation, limit: 10, cursor: null })).kind, 'ERROR');
  assert.equal(db.get('SELECT count(*) AS n FROM operations').n, 1);
});

test('keyset pages preserve scope and validate limits', async t => {
  const { store, proposal } = await setup(t);
  for (const id of ['a', 'b', 'c']) await store.accept(proposeAcceptance(input({ id }), 1000, id, limits));
  const query = { ...proposal.operation, limit: 2, cursor: null };
  const first = (await store.scanWork(query)).value;
  assert.deepEqual(first.items.map(op => op.id), ['a', 'b']);
  assert.equal(first.nextCursor, 'b');
  assert.deepEqual((await store.scanWork({ ...query, cursor: 'b' })).value.items.map(op => op.id), ['c']);
  assert.equal((await store.scanWork({ ...query, limit: 0 })).kind, 'ERROR');
  assert.equal((await store.getMutation(proposal.operation, 'absent')).value, null);
});

test('diagnostic inventory is scoped, filtered and keyset paged', async t => {
  const { store } = await setup(t);
  for (const id of ['a-payment', 'b-order', 'c-payment']) await store.accept(proposeAcceptance(input({ id }), 1000, `accept-${id}`, limits));
  await store.accept(proposeAcceptance(input({ id: 'other-scope', principalScope: 'other' }), 1000, 'other-scope', limits));
  const query = { principalScope: 'account-1', targetScope: 'production', cursor: null, limit: 1, id: 'payment' };
  const first = (await store.listInspection(query)).value;
  assert.deepEqual(first.items.map(operation => operation.id), ['a-payment']);
  assert.equal(first.nextCursor, 'a-payment');
  assert.deepEqual((await store.listInspection({ ...query, cursor: first.nextCursor })).value.items.map(operation => operation.id), ['c-payment']);
  assert.equal((await store.listInspection({ ...query, id: '' })).kind, 'ERROR');
});

test('verification persists backend completion after uncertainty', async t => {
  const { store, proposal, time } = await setup(t);
  await store.accept(proposal);
  const active = (await store.claim(request(proposal.operation, claimCommand(proposal.operation)))).operation;
  time(1040);
  const unknown = (await store.commitTransition(request(active, resultCommand(active, { kind: 'AMBIGUOUS' })))).operation;
  assert.equal(unknown.status, 'UNKNOWN');
  time(1100);
  const verifying = (await store.claim(request(unknown, claimCommand(unknown, 'verification')))).operation;
  time(1120);
  const done = await store.commitTransition(request(verifying, resultCommand(verifying)));
  assert.equal(done.operation.status, 'COMPLETED');
  assert.deepEqual((await store.get(proposal.operation)).value, done.operation);
  const first = (await store.readEvents(proposal.operation, { cursor: null, limit: 2 })).value;
  assert.equal(first.nextCursor, '1');
  assert.equal((await store.readEvents(proposal.operation, { cursor: first.nextCursor, limit: 10 })).value.items.length, 3);
});

test('lease checks use clock after acquiring transaction, ignoring stale caller time', async t => {
  const { store, proposal, time } = await setup(t);
  await store.accept(proposal);
  const active = (await store.claim(request(proposal.operation, claimCommand(proposal.operation)))).operation;
  time(5000);
  assert.equal((await store.commitTransition(request(active, resultCommand(active)))).code, 'LeaseLost');
  assert.equal((await store.get(proposal.operation)).value.status, 'EXECUTING');
});

test('confirmed local rejection is terminal and retained on disk', async t => {
  const { store, proposal } = await setup(t);
  await store.accept(proposal);
  const failed = await store.commitTransition(request(proposal.operation, { kind: 'FAIL_LOCAL', reason: 'LOCAL_REJECTION', code: 'BAD_INPUT' }));
  assert.equal(failed.operation.status, 'FAILED');
  assert.deepEqual((await store.get(proposal.operation)).value, failed.operation);
});
