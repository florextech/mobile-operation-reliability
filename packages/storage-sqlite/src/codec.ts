import { assertOperationInvariants, canonicalJson, snapshotInput, snapshotJson } from '@florexlabs/core';
import type { JsonValue, Operation, OperationChange, OperationEvent, PayloadLimits } from '@florexlabs/core';
import { ensure } from './errors.js';

type Validator = (value: unknown) => void;
const text: Validator = value => ensure(typeof value === 'string' && value.trim().length > 0, 'InvalidRecord');
const number: Validator = value => ensure(Number.isSafeInteger(value) && Number(value) >= 0, 'InvalidRecord');
const boolean: Validator = value => ensure(typeof value === 'boolean', 'InvalidRecord');
const json: Validator = value => { snapshotJson(value, { maxBytes: 1048576, maxDepth: 64 }); };
const nullable = (validate: Validator): Validator => value => { if (value !== null) validate(value); };
const oneOf = (...values: readonly unknown[]): Validator => value => ensure(values.includes(value), 'InvalidRecord');
function object(fields: Readonly<Record<string, Validator>>): Validator {
  return value => {
    ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 'InvalidRecord');
    const record = value as Record<string, unknown>;
    ensure(Object.keys(record).length === Object.keys(fields).length, 'InvalidRecord');
    for (const [key, validate] of Object.entries(fields)) { ensure(Object.hasOwn(record, key), 'InvalidRecord'); validate(record[key]); }
  };
}
const status = oneOf('ACCEPTED', 'EXECUTING', 'UNKNOWN', 'VERIFYING', 'COMPLETED', 'FAILED');
const action = oneOf('execution', 'verification');
const evidence = object({ operationId: text, attemptId: text, source: oneOf('BACKEND', 'LOCAL'), scope: oneOf('OPERATION', 'ATTEMPT'), observedAt: number, code: text });
const attemptPolicy = object({ maxAttempts: number, timeoutMs: number, baseDelayMs: number, maxDelayMs: number });
const replay: Validator = value => {
  ensure(value !== null && typeof value === 'object' && 'kind' in value, 'InvalidRecord');
  switch (value.kind) {
    case 'NONE': object({ kind: oneOf('NONE') })(value); break;
    case 'IDEMPOTENT': object({ kind: oneOf('IDEMPOTENT'), contractVersion: text })(value); break;
    case 'DEDUPLICATED': object({ kind: oneOf('DEDUPLICATED'), contractVersion: text, retentionMs: number, safetyMarginMs: number })(value); break;
    default: ensure(false, 'InvalidRecord');
  }
};
const operationError: Validator = value => {
  const fields: Record<string, Validator> = {
    code: text, category: oneOf('ADMISSION', 'STORAGE', 'CONCURRENCY', 'PREPARATION', 'TRANSPORT', 'BUSINESS', 'VERIFICATION', 'CONTRACT', 'TELEMETRY'),
    certainty: oneOf('NOT_APPLIED', 'UNKNOWN', 'NOT_APPLICABLE'), scope: oneOf('ATTEMPT', 'OPERATION', 'LOCAL'),
    action: oneOf('REJECT', 'RECONCILE', 'RELOAD', 'HOLD', 'RETRY_IF_SAFE', 'IGNORE'), message: text,
  };
  if (value !== null && typeof value === 'object' && 'operationId' in value) fields.operationId = text;
  object(fields)(value);
};
const operationSchema = object({
  id: text, type: text, definitionVersion: text, payload: json, principalScope: text, targetScope: text,
  idempotencyKey: nullable(text), policySnapshot: object({ execution: attemptPolicy, verification: attemptPolicy, replay }),
  recordSchemaVersion: oneOf(1), revision: number, acceptedAt: number, updatedAt: number,
  executionCount: number, verificationCount: number, firstExecutionAt: nullable(number), fence: number,
  lastEvidence: nullable(evidence), lastError: nullable(operationError), status, unresolvedEffect: boolean,
  activeAttempt: nullable(object({ id: text, kind: action, ordinal: number, startedAt: number, deadlineAt: number })),
  lease: nullable(object({ ownerId: text, fence: number, expiresAt: number })),
  completion: nullable(object({ evidence, result: json })),
  failure: nullable(object({ kind: oneOf('BUSINESS_REJECTION', 'BUDGET_EXHAUSTED', 'LOCAL_REJECTION', 'NOT_RETRYABLE'), code: text })),
  schedule: nullable(object({ kind: action, at: number })),
  holdReason: oneOf(null, 'CREDENTIALS', 'DEFINITION_MISSING', 'CONFIGURATION', 'VERIFICATION_BUDGET'),
});
const eventSchema = object({ operationId: text, revision: number, mutationId: text, from: nullable(status), to: status, occurredAt: number, trigger: text, attemptId: nullable(text) });
const recordLimits = { maxBytes: 1048576, maxDepth: 64 };

export function encode(value: unknown): string {
  return canonicalJson(snapshotJson(value, recordLimits));
}
function parse(value: unknown): JsonValue {
  ensure(typeof value === 'string' && value.length <= recordLimits.maxBytes, 'InvalidRecord');
  return snapshotJson(JSON.parse(value) as unknown, recordLimits);
}
export function decodeOperation(value: unknown, limits: PayloadLimits): Operation {
  const parsed = parse(value);
  operationSchema(parsed);
  const operation = parsed as unknown as Operation;
  snapshotInput(operation, limits);
  assertOperationInvariants(operation);
  ensure(typeof operation.unresolvedEffect === 'boolean', 'InvalidRecord');
  ensure(operation.lastEvidence === null || operation.lastEvidence.operationId === operation.id, 'InvalidRecord');
  return operation;
}
export function decodeEvent(value: unknown): OperationEvent {
  const parsed = parse(value); eventSchema(parsed);
  return parsed as unknown as OperationEvent;
}
export function decodeChange(value: unknown, limits: PayloadLimits): OperationChange {
  const parsed = parse(value);
  object({ operation: operationSchema, event: nullable(eventSchema), mutationId: text, expectedRevision: nullable(number) })(parsed);
  const change = parsed as unknown as OperationChange;
  decodeOperation(encode(change.operation), limits);
  const revision = change.expectedRevision === null ? 0 : change.expectedRevision + 1;
  ensure(change.operation.revision === revision, 'InvalidRecord');
  if (change.event) {
    ensure(change.event.operationId === change.operation.id && change.event.revision === revision, 'InvalidRecord');
    ensure(change.event.mutationId === change.mutationId && change.event.to === change.operation.status, 'InvalidRecord');
  }
  return change;
}
