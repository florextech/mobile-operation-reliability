import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeAcceptance } from '@florexlabs/mor';
import { AsyncSQLiteOperationStore } from '../dist/index.js';
import { NodeSQLiteConnection } from '../../storage-sqlite/dist/node.js';
import { input, limits, claimCommand, context, resultCommand } from '../../core/test/helpers.mjs';

/** Conformance driver: it has Expo's async/exclusive shape while Node SQLite
 * supplies deterministic fault-free SQL for the storage contract tests. */
function asyncDriver(connection) {
  const transaction = {
    execAsync: async sql => connection.exec(sql),
    runAsync: async (sql, params) => ({ changes: connection.run(sql, params) }),
    getFirstAsync: async (sql, params = []) => connection.get(sql, params) ?? null,
    getAllAsync: async (sql, params = []) => connection.all(sql, params),
  };
  return {
    ...transaction,
    async withExclusiveTransactionAsync(work) {
      connection.exec('BEGIN IMMEDIATE');
      try { const value = await work(transaction); connection.exec('COMMIT'); return value; }
      catch (error) { if (connection.inTransaction) connection.exec('ROLLBACK'); throw error; }
    },
    closeAsync: async () => connection.close(),
  };
}
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mor-expo-'));
  const connection = new NodeSQLiteConnection(join(dir, 'operations.db'));
  let now = 1020;
  const store = new AsyncSQLiteOperationStore(asyncDriver(connection), { wallNow: () => now }, limits);
  t.after(async () => { await store.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await store.open(1)).kind, 'OK');
  return { store, proposal: proposeAcceptance(input(), 1000, 'accept', limits), time: value => { now = value; } };
}
function request(op, command, mutationId = `change-${op.revision}`) { return { key: { id: op.id, principalScope: op.principalScope, targetScope: op.targetScope }, context: context(op, { mutationId }), command }; }

test('exclusive async transaction durably accepts and replays an operation', async t => {
  const { store, proposal } = await setup(t);
  const accepted = await store.accept(proposal);
  assert.equal(accepted.kind, 'COMMITTED');
  assert.deepEqual(await store.accept(proposal), accepted);
  assert.deepEqual((await store.getMutation(proposal.operation, 'accept')).value, proposal);
  assert.equal((await store.readEvents(proposal.operation, { cursor: null, limit: 10 })).value.items.length, 1);
});

test('async store atomically advances an execution through completion', async t => {
  const { store, proposal, time } = await setup(t);
  await store.accept(proposal);
  const active = await store.claim(request(proposal.operation, claimCommand(proposal.operation)));
  assert.equal(active.kind, 'COMMITTED');
  time(1040);
  const completed = await store.commitTransition(request(active.operation, resultCommand(active.operation)));
  assert.equal(completed.kind, 'COMMITTED');
  assert.equal(completed.operation.status, 'COMPLETED');
  assert.equal((await store.scanWork({ ...proposal.operation, cursor: null, limit: 10 })).value.items.length, 0);
});

test('async store exposes a scoped diagnostic inventory without affecting work scans', async t => {
  const { store, proposal } = await setup(t);
  await store.accept(proposal);
  const page = await store.listInspection({ principalScope: proposal.operation.principalScope, targetScope: proposal.operation.targetScope, cursor: null, limit: 10, status: 'ACCEPTED' });
  assert.equal(page.kind, 'OK');
  assert.deepEqual(page.value.items.map(operation => operation.id), [proposal.operation.id]);
});
