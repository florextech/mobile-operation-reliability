import { DatabaseSync } from 'node:sqlite';
import type { ClockPort, PayloadLimits } from '@florexlabs/mor';
import type { SQLiteConnection, SqlValue } from './driver.js';
import { SQLiteOperationStore } from './store.js';

export class NodeSQLiteConnection implements SQLiteConnection {
  private readonly db: DatabaseSync;
  constructor(path: string) { this.db = new DatabaseSync(path); }
  get inTransaction() { return this.db.isTransaction; }
  exec(sql: string) { this.db.exec(sql); }
  run(sql: string, params: readonly SqlValue[]) { return Number(this.db.prepare(sql).run(...params).changes); }
  get(sql: string, params: readonly SqlValue[] = []) { return this.db.prepare(sql).get(...params); }
  all(sql: string, params: readonly SqlValue[] = []) { return this.db.prepare(sql).all(...params); }
  close() { this.db.close(); }
}
export function createNodeSQLiteStore(path: string, clock: Pick<ClockPort, 'wallNow'>, limits: PayloadLimits) {
  return new SQLiteOperationStore(new NodeSQLiteConnection(path), clock, limits);
}
