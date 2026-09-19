import type { Operation, OperationEvent, OperationKey, OperationScope, OperationStatus, Page, ReadResult } from '@florexlabs/core';
import { snapshotJson } from '@florexlabs/core';

/** Every diagnostic list is scoped. A read-only tool must never turn an
 * operation inventory into a cross-principal data disclosure. */
export interface InspectorQuery extends OperationScope { readonly cursor: string | null; readonly limit: number; readonly status?: OperationStatus; readonly id?: string }
/** Read-only capability deliberately separate from StoragePort. It may expose
 * terminal records, whereas scanWork is an execution candidate query. */
export interface InspectorRepository {
  list(query: InspectorQuery): Promise<ReadResult<Page<Operation>>>;
  get(key: OperationKey): Promise<ReadResult<Operation | null>>;
  readEvents(key: OperationKey, page: { readonly cursor: string | null; readonly limit: number }): Promise<ReadResult<Page<OperationEvent>>>;
}
export interface RedactionPolicy { readonly keyPattern?: RegExp; readonly replacement?: string; readonly maxDepth?: number }
export interface OperationDetail { readonly operation: Operation; readonly events: readonly OperationEvent[]; readonly payload: unknown }

export function redact(value: unknown, policy: RedactionPolicy = {}): unknown {
  const pattern = policy.keyPattern ?? /password|secret|token|authorization|cookie|api[-_]?key/i;
  const replacement = policy.replacement ?? '[REDACTED]'; const maxDepth = policy.maxDepth ?? 16;
  const visit = (input: unknown, depth: number): unknown => {
    if (depth > maxDepth) return '[TRUNCATED]';
    if (Array.isArray(input)) return input.map(item => visit(item, depth + 1));
    if (input !== null && typeof input === 'object') return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([key, item]) => [key, pattern.test(key) ? replacement : visit(item, depth + 1)]));
    return input;
  };
  return visit(snapshotJson(value, { maxBytes: 1048576, maxDepth: 64 }), 0);
}

export class OperationInspector {
  constructor(private readonly repository: InspectorRepository, private readonly redaction: RedactionPolicy = {}) {}
  list(query: InspectorQuery) { return this.repository.list(query); }
  async detail(key: OperationKey): Promise<ReadResult<OperationDetail | null>> {
    const record = await this.repository.get(key);
    if (record.kind === 'ERROR') return record;
    if (record.value === null) return { kind: 'OK', value: null };
    const events: OperationEvent[] = []; let cursor: string | null = null;
    do { const page = await this.repository.readEvents(key, { cursor, limit: 100 }); if (page.kind === 'ERROR') return page; events.push(...page.value.items); cursor = page.value.nextCursor; } while (cursor !== null);
    return { kind: 'OK', value: Object.freeze({ operation: record.value, events: Object.freeze(events), payload: redact(record.value.payload, this.redaction) }) };
  }
}
