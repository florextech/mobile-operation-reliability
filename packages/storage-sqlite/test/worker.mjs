import process from 'node:process';
import { createNodeSQLiteStore, NodeSQLiteConnection } from '../dist/node.js';
import { SQLiteOperationStore } from '../dist/index.js';
import { proposeAcceptance } from '@florextech/core';
import { input, limits, claimCommand, context } from '../../core/test/helpers.mjs';

const [path, mode] = process.argv.slice(2);
const clock = { wallNow: () => 1020 };
if (mode === 'claim') {
  const store = createNodeSQLiteStore(path, clock, limits);
  await store.open(1);
  const op = (await store.get(input())).value;
  process.send('ready');
  process.once('message', async () => {
    const result = await store.claim({ key: input(), context: context(op, { mutationId: `claim-${process.pid}` }), command: claimCommand(op, 'execution', { ownerId: `owner-${process.pid}` }) });
    await store.close();
    process.send(result, () => process.disconnect());
  });
} else {
  const db = new NodeSQLiteConnection(path);
  let armed = false;
  const wrapper = {
    get inTransaction() { return db.inTransaction; },
    exec(sql) {
      if (armed && sql === 'COMMIT' && mode === 'before') process.kill(process.pid, 'SIGKILL');
      db.exec(sql);
      if (armed && sql === 'COMMIT' && mode === 'after') process.kill(process.pid, 'SIGKILL');
    },
    run: (...a) => db.run(...a), get: (...a) => db.get(...a), all: (...a) => db.all(...a), close: () => db.close(),
  };
  const store = new SQLiteOperationStore(wrapper, clock, limits);
  await store.open(1);
  armed = true;
  await store.accept(proposeAcceptance(input(), 1000, 'accept', limits));
}
