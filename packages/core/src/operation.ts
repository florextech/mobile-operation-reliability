import { integer, nonEmpty, requireCondition } from './error.js';
import type { OperationError } from './error.js';
import { canonicalJson, snapshotJson } from './json.js';
import type { JsonValue, PayloadLimits } from './json.js';
import { validateRetryPolicy } from './retry-policy.js';
import type { RetryPolicy } from './retry-policy.js';

declare const operationIdBrand: unique symbol;
export type OperationId = string & { readonly [operationIdBrand]: true };
export function operationId(value: string): OperationId {
  nonEmpty(value, 'operationId');
  return value as OperationId;
}

export const OPERATION_STATUSES = Object.freeze(['ACCEPTED', 'EXECUTING', 'UNKNOWN', 'VERIFYING', 'COMPLETED', 'FAILED'] as const);
export type OperationStatus = typeof OPERATION_STATUSES[number];
export type ActionKind = 'execution' | 'verification';
export interface OperationScope { readonly principalScope: string; readonly targetScope: string }

export interface OperationInput extends OperationScope {
  readonly id: OperationId;
  readonly type: string;
  readonly definitionVersion: string;
  readonly payload: JsonValue;
  readonly idempotencyKey: string | null;
  readonly policySnapshot: RetryPolicy;
}

export interface Attempt {
  readonly id: string;
  readonly kind: ActionKind;
  readonly ordinal: number;
  readonly startedAt: number;
  readonly deadlineAt: number;
}
export interface Lease { readonly ownerId: string; readonly fence: number; readonly expiresAt: number }
export interface Schedule { readonly kind: ActionKind; readonly at: number }
export type HoldReason = 'CREDENTIALS' | 'DEFINITION_MISSING' | 'CONFIGURATION' | 'VERIFICATION_BUDGET';

export interface Evidence {
  readonly operationId: OperationId;
  readonly attemptId: string;
  readonly source: 'BACKEND' | 'LOCAL';
  readonly scope: 'OPERATION' | 'ATTEMPT';
  readonly observedAt: number;
  readonly code: string;
}
export type ExecutionResult =
  | { readonly kind: 'CONFIRMED_COMPLETED'; readonly evidence: Evidence; readonly result: JsonValue }
  | { readonly kind: 'CONFIRMED_REJECTED'; readonly evidence: Evidence }
  | { readonly kind: 'NOT_APPLIED'; readonly evidence: Evidence; readonly retryable: boolean }
  | { readonly kind: 'AMBIGUOUS'; readonly evidence: Evidence };
export type VerificationResult =
  | { readonly kind: 'CONFIRMED_COMPLETED'; readonly evidence: Evidence; readonly result: JsonValue }
  | { readonly kind: 'CONFIRMED_REJECTED'; readonly evidence: Evidence }
  | { readonly kind: 'FINAL_NOT_APPLIED'; readonly evidence: Evidence; readonly retryable: boolean }
  | { readonly kind: 'PENDING' | 'INCONCLUSIVE'; readonly evidence: Evidence };

export interface Completion { readonly evidence: Evidence; readonly result: JsonValue }
export interface Failure {
  readonly kind: 'BUSINESS_REJECTION' | 'BUDGET_EXHAUSTED' | 'LOCAL_REJECTION' | 'NOT_RETRYABLE';
  readonly code: string;
}
interface OperationBase extends OperationInput {
  readonly recordSchemaVersion: 1;
  readonly revision: number;
  readonly acceptedAt: number;
  readonly updatedAt: number;
  readonly executionCount: number;
  readonly verificationCount: number;
  readonly firstExecutionAt: number | null;
  /** Persisted independently of lease so fencing survives lease removal. */
  readonly fence: number;
  readonly lastEvidence: Evidence | null;
  readonly lastError: OperationError | null;
}
interface Idle {
  readonly activeAttempt: null;
  readonly lease: null;
  readonly completion: null;
  readonly failure: null;
  readonly schedule: Schedule | null;
  readonly holdReason: HoldReason | null;
}
interface Active {
  readonly activeAttempt: Attempt;
  readonly lease: Lease;
  readonly completion: null;
  readonly failure: null;
  readonly schedule: null;
  readonly holdReason: null;
}
interface Terminal {
  readonly activeAttempt: null;
  readonly lease: null;
  readonly schedule: null;
  readonly holdReason: null;
  readonly unresolvedEffect: false;
}
export type Operation = OperationBase & (
  | (Idle & { readonly status: 'ACCEPTED'; readonly unresolvedEffect: false })
  | (Idle & { readonly status: 'UNKNOWN'; readonly unresolvedEffect: true })
  | (Active & { readonly status: 'EXECUTING'; readonly unresolvedEffect: boolean })
  | (Active & { readonly status: 'VERIFYING'; readonly unresolvedEffect: true })
  | (Terminal & { readonly status: 'COMPLETED'; readonly completion: Completion; readonly failure: null })
  | (Terminal & { readonly status: 'FAILED'; readonly completion: null; readonly failure: Failure })
);

export interface OperationEvent {
  readonly operationId: OperationId;
  readonly revision: number;
  readonly mutationId: string;
  readonly from: OperationStatus | null;
  readonly to: OperationStatus;
  readonly occurredAt: number;
  readonly trigger: string;
  readonly attemptId: string | null;
}

/** A proposed transaction; it does not certify that a commit occurred. */
export interface OperationChange {
  readonly operation: Operation;
  readonly event: OperationEvent | null;
  readonly mutationId: string;
  readonly expectedRevision: number | null;
}

export interface AcceptanceChange extends OperationChange {
  readonly operation: Extract<Operation, { status: 'ACCEPTED' }>;
  readonly expectedRevision: null;
  readonly event: OperationEvent;
}

export function snapshotInput(input: OperationInput, limits: PayloadLimits): OperationInput {
  operationId(input.id);
  for (const [label, value] of Object.entries({ type: input.type, definitionVersion: input.definitionVersion, principalScope: input.principalScope, targetScope: input.targetScope })) nonEmpty(value, label);
  if (input.idempotencyKey !== null) nonEmpty(input.idempotencyKey, 'idempotencyKey');
  validateRetryPolicy(input.policySnapshot);
  requireCondition(input.policySnapshot.replay.kind !== 'DEDUPLICATED' || input.idempotencyKey !== null, 'InvalidInput', 'Deduplication requires a stable key');
  const policy = input.policySnapshot;
  return Object.freeze({
    id: input.id, type: input.type, definitionVersion: input.definitionVersion,
    principalScope: input.principalScope, targetScope: input.targetScope,
    idempotencyKey: input.idempotencyKey, payload: snapshotJson(input.payload, limits),
    policySnapshot: Object.freeze({
      execution: Object.freeze({ ...policy.execution }), verification: Object.freeze({ ...policy.verification }), replay: Object.freeze({ ...policy.replay }),
    }),
  });
}

export function sameIntent(a: OperationInput, b: OperationInput): boolean {
  const identity = (input: OperationInput): JsonValue => ({
    id: input.id, type: input.type, definitionVersion: input.definitionVersion,
    principalScope: input.principalScope, targetScope: input.targetScope,
    payload: input.payload, idempotencyKey: input.idempotencyKey,
    policy: { execution: { ...input.policySnapshot.execution }, verification: { ...input.policySnapshot.verification }, replay: { ...input.policySnapshot.replay } },
  });
  return canonicalJson(identity(a)) === canonicalJson(identity(b));
}

function check(condition: unknown, message: string): void {
  requireCondition(condition, 'InvalidOperationInvariant', message);
}

export function assertOperationInvariants(op: Operation): void {
  check(OPERATION_STATUSES.includes(op.status), 'Unknown operation status');
  check(op.recordSchemaVersion === 1, 'Unsupported record schema');
  for (const value of [op.revision, op.executionCount, op.verificationCount, op.fence, op.acceptedAt, op.updatedAt]) integer(value, 'operation counter/timestamp');
  validateRetryPolicy(op.policySnapshot);
  check(op.executionCount <= op.policySnapshot.execution.maxAttempts && op.verificationCount <= op.policySnapshot.verification.maxAttempts, 'Attempt budget exceeded');
  check((op.executionCount === 0) === (op.firstExecutionAt === null), 'First execution timestamp mismatch');
  if (op.firstExecutionAt !== null) integer(op.firstExecutionAt, 'firstExecutionAt');
  check(op.holdReason === null || ['CREDENTIALS', 'DEFINITION_MISSING', 'CONFIGURATION', 'VERIFICATION_BUDGET'].includes(op.holdReason), 'Invalid hold reason');
  const active = op.status === 'EXECUTING' || op.status === 'VERIFYING';
  check(active === (op.lease !== null && op.activeAttempt !== null), 'Active lease/attempt mismatch');
  if (!active) check(op.lease === null && op.activeAttempt === null, 'Inactive operation retains ownership');
  if (active) assertActiveInvariants(op);
  if (op.status === 'UNKNOWN' || op.status === 'VERIFYING') check(op.unresolvedEffect && op.executionCount > 0, 'Missing uncertainty');
  if (op.status === 'ACCEPTED' || op.status === 'FAILED' || op.status === 'COMPLETED') check(!op.unresolvedEffect, 'Resolved state has uncertainty');
  check((op.status === 'COMPLETED') === (op.completion !== null), 'Completion mismatch');
  check((op.status === 'FAILED') === (op.failure !== null), 'Failure mismatch');
  if (op.status === 'COMPLETED') check(op.completion.evidence.source === 'BACKEND' && op.completion.evidence.scope === 'OPERATION' && op.completion.evidence.operationId === op.id, 'Completion requires global backend evidence');
  if (op.status === 'FAILED' || op.status === 'COMPLETED') check(op.schedule === null && op.holdReason === null, 'Terminal scheduling is forbidden');
  assertScheduleInvariants(op);
}

function assertActiveInvariants(op: Extract<Operation, { status: 'EXECUTING' | 'VERIFYING' }>): void {
  const attempt = op.activeAttempt;
  const lease = op.lease;
  nonEmpty(attempt.id, 'attemptId'); nonEmpty(lease.ownerId, 'ownerId');
  integer(attempt.startedAt, 'startedAt'); integer(attempt.deadlineAt, 'deadlineAt'); integer(lease.expiresAt, 'expiresAt');
  check(attempt.deadlineAt > attempt.startedAt, 'Invalid attempt deadline');
  check(lease.fence === op.fence && op.fence > 0, 'Fence mismatch');
  check(attempt.kind === (op.status === 'EXECUTING' ? 'execution' : 'verification'), 'Attempt kind mismatch');
  check(attempt.ordinal === (attempt.kind === 'execution' ? op.executionCount : op.verificationCount) && attempt.ordinal > 0, 'Attempt ordinal mismatch');
  check(op.schedule === null && op.holdReason === null, 'Active operation has scheduling metadata');
}

function assertScheduleInvariants(op: Operation): void {
  if (op.schedule !== null) {
    integer(op.schedule.at, 'schedule.at');
    check(op.status === 'ACCEPTED' || op.status === 'UNKNOWN', 'Only idle states can be scheduled');
    check(op.status !== 'ACCEPTED' || op.schedule.kind === 'execution', 'ACCEPTED can only execute');
    check(op.schedule.kind === 'execution' || op.schedule.kind === 'verification', 'Invalid scheduled action');
  }
}
