import type { SQLiteConnection } from './driver.js';
import { ensure } from './errors.js';

const schema = `
CREATE TABLE operations (
  id TEXT PRIMARY KEY NOT NULL,
  principal_scope TEXT NOT NULL,
  target_scope TEXT NOT NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL CHECK(status IN ('ACCEPTED','EXECUTING','UNKNOWN','VERIFYING','COMPLETED','FAILED')),
  revision INTEGER NOT NULL CHECK(revision >= 0),
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  UNIQUE(principal_scope, target_scope, idempotency_key)
) STRICT;
CREATE INDEX operations_work ON operations(principal_scope, target_scope, id)
  WHERE status NOT IN ('COMPLETED','FAILED');
CREATE TABLE operation_events (
  operation_id TEXT NOT NULL REFERENCES operations(id),
  revision INTEGER NOT NULL,
  event TEXT NOT NULL CHECK(json_valid(event)),
  PRIMARY KEY(operation_id, revision)
) STRICT;
CREATE TABLE operation_mutations (
  operation_id TEXT NOT NULL REFERENCES operations(id),
  mutation_id TEXT NOT NULL,
  request TEXT NOT NULL CHECK(json_valid(request)),
  change TEXT NOT NULL CHECK(json_valid(change)),
  PRIMARY KEY(operation_id, mutation_id)
) STRICT;
PRAGMA user_version = 1;
`;

export function initialize(db: SQLiteConnection): void {
  ensure(!db.inTransaction, 'ConnectionAlreadyInTransaction');
  const file = db.all('PRAGMA database_list').find(row => row.name === 'main')?.file;
  ensure(typeof file === 'string' && file.length > 0, 'DurabilityUnsupported');
  ensure(db.get('PRAGMA journal_mode = WAL')?.journal_mode === 'wal', 'DurabilityUnsupported');
  db.exec('PRAGMA synchronous = FULL; PRAGMA fullfsync = ON; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  ensure(db.get('PRAGMA synchronous')?.synchronous === 2, 'DurabilityUnsupported');
  ensure(db.get('PRAGMA foreign_keys')?.foreign_keys === 1, 'DurabilityUnsupported');
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = db.get('PRAGMA user_version')?.user_version;
    ensure(version === 0 || version === 1, 'UnsupportedSchemaVersion');
    if (version === 0) {
      ensure(db.all("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").length === 0, 'UnrecognizedDatabase');
      db.exec(schema);
    }
    ensure(db.get('PRAGMA quick_check')?.quick_check === 'ok', 'StorageCorrupt');
    db.get('SELECT id, principal_scope, target_scope, idempotency_key, status, revision, snapshot FROM operations LIMIT 1');
    db.get('SELECT operation_id, revision, event FROM operation_events LIMIT 1');
    db.get('SELECT operation_id, mutation_id, request, change FROM operation_mutations LIMIT 1');
    ensure(db.all('PRAGMA foreign_key_check').length === 0, 'StorageCorrupt');
    db.exec('COMMIT');
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
