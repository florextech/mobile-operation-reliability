import { proposeAcceptance, sameIntent, transition } from '@florexlabs/mor';
import type { AcceptanceChange, AcceptanceResult, ClockPort, MutationRequest, MutationResult, Operation, OperationChange, OperationKey, OperationScope, OperationStatus, Page, PageQuery, PayloadLimits, ReadResult, StoragePort } from '@florexlabs/mor';
import type { SQLiteConnection, SqlRow } from './driver.js';
import { decodeChange, decodeEvent, decodeOperation, encode } from './codec.js';
import { ensure, mutationError, storageError } from './errors.js';
import { initialize } from './schema.js';

/** Optional, read-only inventory capability for diagnostics adapters. It is
 * deliberately outside StoragePort because executors must not depend on it. */
export interface InspectionQuery extends OperationScope {
  readonly cursor: string | null;
  readonly limit: number;
  readonly status?: OperationStatus;
  readonly id?: string;
}

export class SQLiteOperationStore implements StoragePort {
  private ready = false;
  constructor(private readonly db: SQLiteConnection, private readonly clock: Pick<ClockPort, 'wallNow'>, private readonly limits: PayloadLimits) {}
  async open(expectedSchemaVersion: 1): Promise<ReadResult<void>> {
    return this.read(() => { this.ready = false; ensure(expectedSchemaVersion === 1, 'UnsupportedSchema'); initialize(this.db); this.ready = true; }, false);
  }
  private read<T>(work: () => T, check = true): ReadResult<T> {
    try {
      if (check) {
        ensure(this.ready, 'StoreClosed');
      }
      return { kind: 'OK', value: work() };
    }
    catch (error) { return { kind: 'ERROR', error: storageError(error) }; }
  }
  private operation(row: SqlRow): Operation {
    const op = decodeOperation(row.snapshot, this.limits);
    ensure(op.id === row.id && op.revision === row.revision && op.status === row.status && op.principalScope === row.principal_scope && op.targetScope === row.target_scope && op.idempotencyKey === row.idempotency_key, 'InvalidRecord');
    return op;
  }
  private lookup(key: OperationKey): Operation | null {
    const row = this.db.get('SELECT * FROM operations WHERE id=? AND principal_scope=? AND target_scope=?', [key.id, key.principalScope, key.targetScope]);
    return row ? this.operation(row) : null;
  }
  private transaction(key: OperationKey, mutationId: string, work: () => AcceptanceResult): AcceptanceResult {
    let committing = false;
    try {
      ensure(this.ready, 'StoreClosed');
      this.db.exec('BEGIN IMMEDIATE');
      const result = work();
      committing = true;
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { if (this.db.inTransaction) this.db.exec('ROLLBACK'); } catch { this.ready = false; }
      return committing ? { kind: 'INDETERMINATE', operationId: key.id, mutationId } : mutationError(error);
    }
  }
  private prior(key: OperationKey, mutationId: string, request: string): MutationResult | null {
    const row = this.db.get('SELECT request, change FROM operation_mutations WHERE operation_id=? AND mutation_id=?', [key.id, mutationId]);
    if (!row) return null;
    if (row.request !== request) return { kind: 'CONFLICT', code: 'IdentityConflict' };
    const change = decodeChange(row.change, this.limits);
    ensure(change.operation.id === key.id && change.mutationId === mutationId, 'InvalidRecord');
    return { kind: 'COMMITTED', operation: change.operation, mutationId };
  }
  private persist(change: OperationChange, request: string): MutationResult {
    const op = change.operation;
    if (change.expectedRevision === null) {
      this.db.run('INSERT INTO operations(id,principal_scope,target_scope,idempotency_key,status,revision,snapshot) VALUES(?,?,?,?,?,?,?)', [op.id, op.principalScope, op.targetScope, op.idempotencyKey, op.status, op.revision, encode(op)]);
    } else {
      ensure(this.db.run('UPDATE operations SET status=?,revision=?,snapshot=? WHERE id=? AND revision=?', [op.status, op.revision, encode(op), op.id, change.expectedRevision]) === 1, 'RevisionConflict');
    }
    if (change.event) this.db.run('INSERT INTO operation_events(operation_id,revision,event) VALUES(?,?,?)', [op.id, op.revision, encode(change.event)]);
    this.db.run('INSERT INTO operation_mutations(operation_id,mutation_id,request,change) VALUES(?,?,?,?)', [op.id, change.mutationId, request, encode(change)]);
    return { kind: 'COMMITTED', operation: op, mutationId: change.mutationId };
  }
  async accept(proposal: AcceptanceChange): Promise<AcceptanceResult> {
    return this.transaction(proposal.operation, proposal.mutationId, () => {
      const op = proposal.operation;
      ensure(encode(proposal) === encode(proposeAcceptance(op, op.acceptedAt, proposal.mutationId, this.limits)), 'InvalidAcceptance');
      const request = encode(proposal);
      const previous = this.prior(op, proposal.mutationId, request);
      if (previous) return previous;
      const existing = this.db.get('SELECT * FROM operations WHERE id=?', [op.id]);
      if (existing) return sameIntent(this.operation(existing), op) ? { kind: 'EXISTING', operation: this.operation(existing) } : { kind: 'CONFLICT', code: 'IdentityConflict' };
      const duplicate = op.idempotencyKey !== null && this.db.get('SELECT id FROM operations WHERE principal_scope=? AND target_scope=? AND idempotency_key=?', [op.principalScope, op.targetScope, op.idempotencyKey]);
      if (duplicate) return { kind: 'CONFLICT', code: 'IdentityConflict' };
      return this.persist(decodeChange(request, this.limits), request);
    });
  }
  private async mutate(request: MutationRequest): Promise<MutationResult> {
    const result = this.transaction(request.key, request.context.mutationId, () => {
      const op = this.lookup(request.key);
      ensure(op, 'OperationNotFound');
      const fingerprint = encode(request);
      const previous = this.prior(request.key, request.context.mutationId, fingerprint);
      if (previous) return previous;
      const change = transition(op, request.command, { ...request.context, now: this.clock.wallNow() });
      return this.persist(change, fingerprint);
    });
    ensure(result.kind !== 'EXISTING', 'InvalidMutation');
    return result;
  }
  claim: StoragePort['claim'] = request => this.mutate(request);
  renew: StoragePort['renew'] = request => this.mutate(request);
  commitTransition: StoragePort['commitTransition'] = request => this.mutate(request);
  recoverExpired: StoragePort['recoverExpired'] = request => this.mutate(request);
  updateScheduling: StoragePort['updateScheduling'] = request => this.mutate(request);
  async get(key: OperationKey) { return this.read(() => this.lookup(key)); }
  async scanWork(query: PageQuery) {
    return this.read(() => {
      this.page(query);
      const rows = this.db.all("SELECT * FROM operations WHERE principal_scope=? AND target_scope=? AND status NOT IN('COMPLETED','FAILED') AND id>? ORDER BY id LIMIT ?", [query.principalScope, query.targetScope, query.cursor ?? '', query.limit + 1]);
      const items = rows.slice(0, query.limit).map(row => this.operation(row));
      return { items, nextCursor: rows.length > query.limit ? items.at(-1)!.id : null };
    });
  }
  async listInspection(query: InspectionQuery): Promise<ReadResult<Page<Operation>>> {
    return this.read(() => {
      this.page(query);
      ensure(query.status === undefined || ['ACCEPTED', 'EXECUTING', 'UNKNOWN', 'VERIFYING', 'COMPLETED', 'FAILED'].includes(query.status), 'InvalidPage');
      ensure(query.id === undefined || (typeof query.id === 'string' && query.id.length > 0), 'InvalidPage');
      const rows = this.db.all(
        'SELECT * FROM operations WHERE principal_scope=? AND target_scope=? AND id>? AND (? IS NULL OR status=?) AND (? IS NULL OR instr(id,?)>0) ORDER BY id LIMIT ?',
        [query.principalScope, query.targetScope, query.cursor ?? '', query.status ?? null, query.status ?? null, query.id ?? null, query.id ?? '', query.limit + 1],
      );
      const items = rows.slice(0, query.limit).map(row => this.operation(row));
      return { items, nextCursor: rows.length > query.limit ? items.at(-1)!.id : null };
    });
  }
  private page(page: { cursor: string | null; limit: number }) {
    ensure(Number.isSafeInteger(page.limit) && page.limit > 0 && page.limit <= 1000, 'InvalidPage');
    ensure(page.cursor === null || typeof page.cursor === 'string', 'InvalidPage');
  }
  async getMutation(key: OperationKey, mutationId: string) {
    return this.read(() => {
      if (!this.lookup(key)) return null;
      const row = this.db.get('SELECT change FROM operation_mutations WHERE operation_id=? AND mutation_id=?', [key.id, mutationId]);
      if (!row) return null;
      const change = decodeChange(row.change, this.limits);
      ensure(change.operation.id === key.id && change.mutationId === mutationId, 'InvalidRecord');
      return change;
    });
  }
  async readEvents(key: OperationKey, page: { cursor: string | null; limit: number }) {
    return this.read(() => {
      this.page(page);
      const cursor = page.cursor === null ? -1 : Number(page.cursor);
      ensure(Number.isSafeInteger(cursor) && cursor >= -1, 'InvalidPage');
      if (!this.lookup(key)) return { items: [], nextCursor: null };
      const rows = this.db.all('SELECT revision,event FROM operation_events WHERE operation_id=? AND revision>? ORDER BY revision LIMIT ?', [key.id, cursor, page.limit + 1]);
      const items = rows.slice(0, page.limit).map(row => {
        const event = decodeEvent(row.event);
        ensure(event.operationId === key.id && event.revision === row.revision, 'InvalidRecord');
        return event;
      });
      return { items, nextCursor: rows.length > page.limit ? String(items.at(-1)!.revision) : null };
    });
  }
  async close(): Promise<ReadResult<void>> {
    return this.read(() => { this.ready = false; this.db.close(); }, false);
  }
}
