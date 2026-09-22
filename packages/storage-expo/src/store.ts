import { proposeAcceptance, sameIntent, transition } from '@florexlabs/mor';
import type { AcceptanceChange, AcceptanceResult, ClockPort, MutationRequest, MutationResult, Operation, OperationChange, OperationKey, OperationScope, OperationStatus, Page, PageQuery, PayloadLimits, ReadResult, StoragePort } from '@florexlabs/mor';
import { decodeChange, decodeEvent, decodeOperation, encode, ensure, mutationError, storageError } from '@florexlabs/mor-sqlite/records';
import type { ExpoSQLiteDatabase, ExpoSQLiteTransaction, SqlRow } from './driver.js';
import { initialize } from './schema.js';

/** Optional, read-only inventory capability for diagnostics adapters. It is
 * deliberately outside StoragePort because executors must not depend on it. */
export interface InspectionQuery extends OperationScope {
  readonly cursor: string | null;
  readonly limit: number;
  readonly status?: OperationStatus;
  readonly id?: string;
}

/** Async StoragePort implementation for expo-sqlite's exclusive transaction API.
 * Every mutating decision and its three durable records run in one exclusive task. */
export class AsyncSQLiteOperationStore implements StoragePort {
  private ready = false;
  constructor(private readonly db: ExpoSQLiteDatabase, private readonly clock: Pick<ClockPort, 'wallNow'>, private readonly limits: PayloadLimits) {}
  async open(expectedSchemaVersion: 1): Promise<ReadResult<void>> {
    return this.read(async () => { this.ready = false; ensure(expectedSchemaVersion === 1, 'UnsupportedSchema'); await initialize(this.db); this.ready = true; }, false);
  }
  private async read<T>(work: () => Promise<T>, check = true): Promise<ReadResult<T>> {
    try { if (check) ensure(this.ready, 'StoreClosed'); return { kind: 'OK', value: await work() }; }
    catch (error) { return { kind: 'ERROR', error: storageError(error) }; }
  }
  private operation(row: SqlRow): Operation {
    const op = decodeOperation(row.snapshot, this.limits);
    ensure(op.id === row.id && op.revision === row.revision && op.status === row.status && op.principalScope === row.principal_scope && op.targetScope === row.target_scope && op.idempotencyKey === row.idempotency_key, 'InvalidRecord');
    return op;
  }
  private async lookup(db: ExpoSQLiteTransaction, key: OperationKey): Promise<Operation | null> {
    const row = await db.getFirstAsync('SELECT * FROM operations WHERE id=? AND principal_scope=? AND target_scope=?', [key.id, key.principalScope, key.targetScope]);
    return row ? this.operation(row) : null;
  }
  private async transaction(key: OperationKey, mutationId: string, work: (tx: ExpoSQLiteTransaction) => Promise<AcceptanceResult>): Promise<AcceptanceResult> {
    let callbackCompleted = false;
    try {
      ensure(this.ready, 'StoreClosed');
      let result: AcceptanceResult | null = null;
      await this.db.withExclusiveTransactionAsync(async tx => { result = await work(tx); callbackCompleted = true; });
      ensure(result !== null, 'TransactionWithoutResult');
      return result;
    } catch (error) {
      // A rejection after the callback completed is ambiguous to a caller. It must
      // reconcile via getMutation instead of repeating a possible commit blindly.
      return callbackCompleted ? { kind: 'INDETERMINATE', operationId: key.id, mutationId } : mutationError(error);
    }
  }
  private async prior(db: ExpoSQLiteTransaction, key: OperationKey, mutationId: string, request: string): Promise<MutationResult | null> {
    const row = await db.getFirstAsync('SELECT request, change FROM operation_mutations WHERE operation_id=? AND mutation_id=?', [key.id, mutationId]);
    if (!row) return null;
    if (row.request !== request) return { kind: 'CONFLICT', code: 'IdentityConflict' };
    const change = decodeChange(row.change, this.limits);
    ensure(change.operation.id === key.id && change.mutationId === mutationId, 'InvalidRecord');
    return { kind: 'COMMITTED', operation: change.operation, mutationId };
  }
  private async persist(db: ExpoSQLiteTransaction, change: OperationChange, request: string): Promise<MutationResult> {
    const op = change.operation;
    if (change.expectedRevision === null) {
      await db.runAsync('INSERT INTO operations(id,principal_scope,target_scope,idempotency_key,status,revision,snapshot) VALUES(?,?,?,?,?,?,?)', [op.id, op.principalScope, op.targetScope, op.idempotencyKey, op.status, op.revision, encode(op)]);
    } else {
      ensure((await db.runAsync('UPDATE operations SET status=?,revision=?,snapshot=? WHERE id=? AND revision=?', [op.status, op.revision, encode(op), op.id, change.expectedRevision])).changes === 1, 'RevisionConflict');
    }
    if (change.event) await db.runAsync('INSERT INTO operation_events(operation_id,revision,event) VALUES(?,?,?)', [op.id, op.revision, encode(change.event)]);
    await db.runAsync('INSERT INTO operation_mutations(operation_id,mutation_id,request,change) VALUES(?,?,?,?)', [op.id, change.mutationId, request, encode(change)]);
    return { kind: 'COMMITTED', operation: op, mutationId: change.mutationId };
  }
  async accept(proposal: AcceptanceChange): Promise<AcceptanceResult> {
    return this.transaction(proposal.operation, proposal.mutationId, async tx => {
      const op = proposal.operation;
      ensure(encode(proposal) === encode(proposeAcceptance(op, op.acceptedAt, proposal.mutationId, this.limits)), 'InvalidAcceptance');
      const request = encode(proposal); const previous = await this.prior(tx, op, proposal.mutationId, request); if (previous) return previous;
      const existing = await tx.getFirstAsync('SELECT * FROM operations WHERE id=?', [op.id]);
      if (existing) return sameIntent(this.operation(existing), op) ? { kind: 'EXISTING', operation: this.operation(existing) } : { kind: 'CONFLICT', code: 'IdentityConflict' };
      const duplicate = op.idempotencyKey !== null && await tx.getFirstAsync('SELECT id FROM operations WHERE principal_scope=? AND target_scope=? AND idempotency_key=?', [op.principalScope, op.targetScope, op.idempotencyKey]);
      if (duplicate) return { kind: 'CONFLICT', code: 'IdentityConflict' };
      return this.persist(tx, decodeChange(request, this.limits), request);
    });
  }
  private async mutate(request: MutationRequest): Promise<MutationResult> {
    const result = await this.transaction(request.key, request.context.mutationId, async tx => {
      const op = await this.lookup(tx, request.key); ensure(op, 'OperationNotFound');
      const fingerprint = encode(request); const previous = await this.prior(tx, request.key, request.context.mutationId, fingerprint); if (previous) return previous;
      return this.persist(tx, transition(op, request.command, { ...request.context, now: this.clock.wallNow() }), fingerprint);
    });
    ensure(result.kind !== 'EXISTING', 'InvalidMutation'); return result;
  }
  claim: StoragePort['claim'] = request => this.mutate(request);
  renew: StoragePort['renew'] = request => this.mutate(request);
  commitTransition: StoragePort['commitTransition'] = request => this.mutate(request);
  recoverExpired: StoragePort['recoverExpired'] = request => this.mutate(request);
  updateScheduling: StoragePort['updateScheduling'] = request => this.mutate(request);
  async get(key: OperationKey) { return this.read(() => this.lookup(this.db, key)); }
  async scanWork(query: PageQuery) { return this.read(async () => {
    this.page(query); const rows = await this.db.getAllAsync('SELECT * FROM operations WHERE principal_scope=? AND target_scope=? AND status NOT IN(\'COMPLETED\',\'FAILED\') AND id>? ORDER BY id LIMIT ?', [query.principalScope, query.targetScope, query.cursor ?? '', query.limit + 1]);
    const items = rows.slice(0, query.limit).map(row => this.operation(row)); return { items, nextCursor: rows.length > query.limit ? items.at(-1)!.id : null };
  }); }
  async listInspection(query: InspectionQuery): Promise<ReadResult<Page<Operation>>> { return this.read(async () => {
    this.page(query);
    ensure(query.status === undefined || ['ACCEPTED', 'EXECUTING', 'UNKNOWN', 'VERIFYING', 'COMPLETED', 'FAILED'].includes(query.status), 'InvalidPage');
    ensure(query.id === undefined || (typeof query.id === 'string' && query.id.length > 0), 'InvalidPage');
    const rows = await this.db.getAllAsync(
      'SELECT * FROM operations WHERE principal_scope=? AND target_scope=? AND id>? AND (? IS NULL OR status=?) AND (? IS NULL OR instr(id,?)>0) ORDER BY id LIMIT ?',
      [query.principalScope, query.targetScope, query.cursor ?? '', query.status ?? null, query.status ?? null, query.id ?? null, query.id ?? '', query.limit + 1],
    );
    const items = rows.slice(0, query.limit).map(row => this.operation(row));
    return { items, nextCursor: rows.length > query.limit ? items.at(-1)!.id : null };
  }); }
  private page(page: { cursor: string | null; limit: number }) { ensure(Number.isSafeInteger(page.limit) && page.limit > 0 && page.limit <= 1000, 'InvalidPage'); ensure(page.cursor === null || typeof page.cursor === 'string', 'InvalidPage'); }
  async getMutation(key: OperationKey, mutationId: string) { return this.read(async () => {
    if (!await this.lookup(this.db, key)) return null; const row = await this.db.getFirstAsync('SELECT change FROM operation_mutations WHERE operation_id=? AND mutation_id=?', [key.id, mutationId]); if (!row) return null;
    const change = decodeChange(row.change, this.limits); ensure(change.operation.id === key.id && change.mutationId === mutationId, 'InvalidRecord'); return change;
  }); }
  async readEvents(key: OperationKey, page: { cursor: string | null; limit: number }) { return this.read(async () => {
    this.page(page); const cursor = page.cursor === null ? -1 : Number(page.cursor); ensure(Number.isSafeInteger(cursor) && cursor >= -1, 'InvalidPage'); if (!await this.lookup(this.db, key)) return { items: [], nextCursor: null };
    const rows = await this.db.getAllAsync('SELECT revision,event FROM operation_events WHERE operation_id=? AND revision>? ORDER BY revision LIMIT ?', [key.id, cursor, page.limit + 1]); const items = rows.slice(0, page.limit).map(row => { const event = decodeEvent(row.event); ensure(event.operationId === key.id && event.revision === row.revision, 'InvalidRecord'); return event; });
    return { items, nextCursor: rows.length > page.limit ? String(items.at(-1)!.revision) : null };
  }); }
  async close(): Promise<ReadResult<void>> { return this.read(async () => { this.ready = false; await this.db.closeAsync(); }, false); }
}
