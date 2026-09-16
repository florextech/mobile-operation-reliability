import { test } from 'node:test';
import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeAcceptance } from '@florextech/core';
import { SQLiteOperationStore } from '../dist/index.js';
import { NodeSQLiteConnection, createNodeSQLiteStore } from '../dist/node.js';
import { input, limits } from '../../core/test/helpers.mjs';

function pathFor(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mor-resilience-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'store.db');
}
const clock = { wallNow: () => 1020 };
for (const mode of ['before', 'after']) {
  test(`process killed ${mode} COMMIT preserves atomic durable state`, { timeout: 10000 }, async t => {
    const path = pathFor(t);
    const worker = fork(new URL('./worker.mjs', import.meta.url), [path, mode], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    t.after(() => worker.kill());
    const [, signal] = await once(worker, 'exit');
    assert.equal(signal, 'SIGKILL');
    const store = createNodeSQLiteStore(path, clock, limits);
    assert.equal((await store.open(1)).kind, 'OK');
    const found = await store.get(input());
    assert.equal(found.kind, 'OK');
    assert.equal(found.value !== null, mode === 'after');
    const events = (await store.readEvents(input(), { limit: 10, cursor: null })).value;
    assert.equal(events.items.length, mode === 'after' ? 1 : 0);
    assert.equal((await store.getMutation(input(), 'accept')).value !== null, mode === 'after');
    await store.close();
  });
}

test('two independent processes racing claim produce exactly one owner', { timeout: 10000 }, async t => {
  const path = pathFor(t);
  const store = createNodeSQLiteStore(path, clock, limits);
  await store.open(1);
  await store.accept(proposeAcceptance(input(), 1000, 'accept', limits));
  const workers = [0, 1].map(() => fork(new URL('./worker.mjs', import.meta.url), [path, 'claim'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }));
  t.after(() => workers.forEach(worker => worker.kill()));
  await Promise.all(workers.map(worker => once(worker, 'message')));
  const results = workers.map(worker => once(worker, 'message'));
  workers.forEach(worker => worker.send('go'));
  const outcomes = (await Promise.all(results)).map(([result]) => result);
  assert.deepEqual(outcomes.map(result => result.kind).sort(), ['COMMITTED', 'CONFLICT']);
  assert.equal(outcomes.find(result => result.kind === 'CONFLICT').code, 'RevisionConflict');
  assert.equal((await store.get(input())).value.fence, 1);
  await store.close();
});

test('real SQLITE_FULL rolls back without issuing acceptance', async t => {
  const db = new NodeSQLiteConnection(pathFor(t));
  const largeLimits = { maxBytes: 300000, maxDepth: 12 };
  const store = new SQLiteOperationStore(db, clock, largeLimits);
  await store.open(1);
  const pages = db.get('PRAGMA page_count').page_count;
  db.exec(`PRAGMA max_page_count=${pages}`);
  const proposal = proposeAcceptance(input({ payload: { data: 'x'.repeat(200000) } }), 1000, 'full', largeLimits);
  const result = await store.accept(proposal);
  assert.equal(result.kind, 'ERROR');
  assert.equal(result.error.code, 'StorageFull');
  assert.equal((await store.get(input())).value, null);
  await store.close();
});

test('failed migration rolls back all DDL and can be retried', async t => {
  const db = new NodeSQLiteConnection(pathFor(t));
  let fail = true;
  const wrapper = {
    get inTransaction() { return db.inTransaction; },
    exec(sql) { db.exec(sql); if (fail && sql.includes('CREATE TABLE')) throw new Error('migration fault'); },
    run: (...a) => db.run(...a), get: (...a) => db.get(...a), all: (...a) => db.all(...a), close: () => db.close(),
  };
  const store = new SQLiteOperationStore(wrapper, clock, limits);
  assert.equal((await store.open(1)).kind, 'ERROR');
  assert.equal(db.get('PRAGMA user_version').user_version, 0);
  assert.equal(db.get("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").n, 0);
  fail = false;
  assert.equal((await store.open(1)).kind, 'OK');
  await store.close();
});

test('memory and newer schema are rejected', async t => {
  const memory = createNodeSQLiteStore(':memory:', clock, limits);
  assert.equal((await memory.open(1)).kind, 'ERROR');
  await memory.close();
  const db = new NodeSQLiteConnection(pathFor(t));
  db.exec('PRAGMA user_version=2');
  const store = new SQLiteOperationStore(db, clock, limits);
  assert.equal((await store.open(1)).kind, 'ERROR');
  assert.equal((await store.get(input())).error.code, 'StoreClosed');
  await store.close();
});
