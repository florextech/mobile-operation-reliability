import type { ExpoSQLiteDatabase, ExpoSQLiteTransaction, SqlRow } from './driver.js';
import { ensure } from '@florextech/storage-sqlite/records';

const schema = `
CREATE TABLE operations (id TEXT PRIMARY KEY NOT NULL, principal_scope TEXT NOT NULL, target_scope TEXT NOT NULL, idempotency_key TEXT, status TEXT NOT NULL CHECK(status IN ('ACCEPTED','EXECUTING','UNKNOWN','VERIFYING','COMPLETED','FAILED')), revision INTEGER NOT NULL CHECK(revision >= 0), snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), UNIQUE(principal_scope, target_scope, idempotency_key)) STRICT;
CREATE INDEX operations_work ON operations(principal_scope, target_scope, id) WHERE status NOT IN ('COMPLETED','FAILED');
CREATE TABLE operation_events (operation_id TEXT NOT NULL REFERENCES operations(id), revision INTEGER NOT NULL, event TEXT NOT NULL CHECK(json_valid(event)), PRIMARY KEY(operation_id, revision)) STRICT;
CREATE TABLE operation_mutations (operation_id TEXT NOT NULL REFERENCES operations(id), mutation_id TEXT NOT NULL, request TEXT NOT NULL CHECK(json_valid(request)), change TEXT NOT NULL CHECK(json_valid(change)), PRIMARY KEY(operation_id, mutation_id)) STRICT;
PRAGMA user_version = 1;`;

const get = <T extends SqlRow>(db: ExpoSQLiteTransaction, sql: string, params: (string | number | null)[] = []) => db.getFirstAsync<T>(sql, params);
export async function initialize(db: ExpoSQLiteDatabase): Promise<void> {
  const file = (await get<{ file: unknown }>(db, 'PRAGMA database_list'))?.file;
  ensure(typeof file === 'string' && file.length > 0, 'DurabilityUnsupported');
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  ensure((await get<{ journal_mode: unknown }>(db, 'PRAGMA journal_mode'))?.journal_mode === 'wal', 'DurabilityUnsupported');
  ensure((await get<{ synchronous: unknown }>(db, 'PRAGMA synchronous'))?.synchronous === 2, 'DurabilityUnsupported');
  ensure((await get<{ foreign_keys: unknown }>(db, 'PRAGMA foreign_keys'))?.foreign_keys === 1, 'DurabilityUnsupported');
  await db.withExclusiveTransactionAsync(async tx => {
    const version = (await get<{ user_version: unknown }>(tx, 'PRAGMA user_version'))?.user_version;
    ensure(version === 0 || version === 1, 'UnsupportedSchemaVersion');
    if (version === 0) {
      ensure((await tx.getAllAsync('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\'', [])).length === 0, 'UnrecognizedDatabase');
      await tx.execAsync(schema);
    }
    ensure((await get<{ quick_check: unknown }>(tx, 'PRAGMA quick_check'))?.quick_check === 'ok', 'StorageCorrupt');
    ensure((await tx.getAllAsync('PRAGMA foreign_key_check', [])).length === 0, 'StorageCorrupt');
  });
}
