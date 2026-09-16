import { addTime, integer, nonEmpty, requireCondition } from './error.js';
import type { PayloadLimits } from './json.js';
import { snapshotJson } from './json.js';
import { assertOperationInvariants, snapshotInput } from './operation.js';
import type { AcceptanceChange, Evidence, ExecutionResult, Failure, HoldReason, Operation, OperationChange, OperationInput, OperationScope, OperationStatus, Schedule, VerificationResult } from './operation.js';
import { isReplaySafe, nextRetryAt } from './retry-policy.js';

export const ALLOWED_TRANSITIONS: Readonly<Record<OperationStatus, readonly OperationStatus[]>> = Object.freeze({
  ACCEPTED: Object.freeze(['EXECUTING', 'FAILED'] as const),
  EXECUTING: Object.freeze(['ACCEPTED', 'UNKNOWN', 'COMPLETED', 'FAILED'] as const),
  UNKNOWN: Object.freeze(['EXECUTING', 'VERIFYING'] as const),
  VERIFYING: Object.freeze(['ACCEPTED', 'UNKNOWN', 'COMPLETED', 'FAILED'] as const),
  COMPLETED: Object.freeze([]), FAILED: Object.freeze([]),
});

export interface MutationContext extends OperationScope {
  readonly mutationId: string;
  readonly expectedRevision: number;
  readonly now: number;
}
export interface Ownership {
  readonly ownerId: string;
  readonly fence: number;
  readonly attemptId: string;
}
export interface Readiness extends OperationScope {
  readonly definitionVersion: string;
  readonly credentialsReady: boolean;
  readonly definitionReady: boolean;
  readonly verifierAvailable: boolean;
  readonly replayContractVersion: string | null;
  readonly clockTrusted: boolean;
}
export interface ClaimCommand {
  readonly kind: 'CLAIM';
  readonly action: 'execution' | 'verification';
  readonly attemptId: string;
  readonly ownerId: string;
  readonly leaseDurationMs: number;
  readonly readiness: Readiness;
}
export type ResolveCommand =
  | { readonly kind: 'EXECUTION_RESULT'; readonly ownership: Ownership; readonly result: ExecutionResult; readonly jitterSample: number; readonly retryAfterAt?: number; readonly resultLimits: PayloadLimits }
  | { readonly kind: 'VERIFICATION_RESULT'; readonly ownership: Ownership; readonly result: VerificationResult; readonly jitterSample: number; readonly retryAfterAt?: number; readonly resultLimits: PayloadLimits };
export type OperationCommand = ClaimCommand | ResolveCommand
  | { readonly kind: 'RECOVER_EXPIRED'; readonly jitterSample: number }
  | { readonly kind: 'FAIL_LOCAL'; readonly reason: 'LOCAL_REJECTION' | 'BUDGET_EXHAUSTED'; readonly code: string }
  | { readonly kind: 'RENEW'; readonly ownership: Ownership; readonly leaseDurationMs: number }
  | { readonly kind: 'SCHEDULE'; readonly schedule: Schedule | null; readonly holdReason: HoldReason | null; readonly jitterSample: number };

/** Build inside acceptance processing; only StoragePort.accept can confirm ownership. */
export function proposeAcceptance(input: OperationInput, now: number, mutationId: string, limits: PayloadLimits): AcceptanceChange {
  integer(now, 'now'); nonEmpty(mutationId, 'mutationId');
  const operation: Extract<Operation, { status: 'ACCEPTED' }> = Object.freeze({
    ...snapshotInput(input, limits), recordSchemaVersion: 1,
    revision: 0, acceptedAt: now, updatedAt: now,
    executionCount: 0, verificationCount: 0, firstExecutionAt: null, fence: 0,
    status: 'ACCEPTED', unresolvedEffect: false,
    activeAttempt: null, lease: null, completion: null, failure: null,
    lastEvidence: null, lastError: null, holdReason: null,
    schedule: Object.freeze({ kind: 'execution', at: now }),
  });
  assertOperationInvariants(operation);
  return Object.freeze({ operation, expectedRevision: null, mutationId, event: Object.freeze({
    operationId: operation.id, revision: 0, mutationId, from: null, to: 'ACCEPTED', occurredAt: now, trigger: 'ACCEPT', attemptId: null,
  }) });
}

function assertOwner(op: Operation, owner: Ownership, now: number): void {
  requireCondition(op.status === 'EXECUTING' || op.status === 'VERIFYING', 'InvalidOperationTransition', 'No active attempt');
  requireCondition(op.lease.ownerId === owner.ownerId && op.lease.fence === owner.fence, 'LeaseLost', 'Lease owner/fence no longer matches');
  requireCondition(op.activeAttempt.id === owner.attemptId, 'StaleAttempt', 'Attempt no longer matches');
  requireCondition(now < op.lease.expiresAt, 'LeaseLost', 'Lease expired');
}

function checkedEvidence(op: Operation, evidence: Evidence): Evidence {
  requireCondition(evidence.operationId === op.id && evidence.attemptId === op.activeAttempt?.id, 'InvalidEvidence', 'Evidence does not correlate to the active operation/attempt');
  requireCondition(['LOCAL', 'BACKEND'].includes(evidence.source) && ['ATTEMPT', 'OPERATION'].includes(evidence.scope), 'InvalidEvidence', 'Invalid evidence source/scope');
  nonEmpty(evidence.code, 'evidence.code'); integer(evidence.observedAt, 'observedAt');
  return Object.freeze({ ...evidence });
}

function globalBackend(evidence: Evidence): void {
  requireCondition(evidence.source === 'BACKEND' && evidence.scope === 'OPERATION', 'InvalidEvidence', 'Global backend evidence required');
}

function idle(op: Operation, status: 'ACCEPTED' | 'UNKNOWN', schedule: Schedule | null = null): Operation {
  const fields = { ...op, activeAttempt: null, lease: null, completion: null, failure: null, holdReason: null, schedule };
  return status === 'ACCEPTED'
    ? { ...fields, status, unresolvedEffect: false }
    : { ...fields, status, unresolvedEffect: true };
}

function failed(op: Operation, failure: Failure): Operation {
  return { ...op, status: 'FAILED', unresolvedEffect: false, activeAttempt: null, lease: null, schedule: null, holdReason: null, completion: null, failure: Object.freeze(failure) };
}

function claim(op: Operation, command: ClaimCommand, now: number): Operation {
  requireCondition(op.status === 'ACCEPTED' || op.status === 'UNKNOWN', 'InvalidOperationTransition', 'Only idle work can be claimed');
  requireCondition(command.action === 'execution' || command.action === 'verification', 'InvalidInput', 'Invalid action');
  const ready = command.readiness;
  requireCondition(ready.principalScope === op.principalScope && ready.targetScope === op.targetScope, 'ScopeMismatch', 'Execution scope mismatch');
  requireCondition(ready.definitionReady && ready.credentialsReady && ready.definitionVersion === op.definitionVersion, 'NotEligible', 'Execution prerequisites unavailable');
  requireCondition(op.holdReason === null && op.schedule !== null && op.schedule.kind === command.action && op.schedule.at <= now, 'NotEligible', 'Action is held, unscheduled or not due');
  if (command.action === 'verification') {
    requireCondition(op.status === 'UNKNOWN', 'InvalidOperationTransition', 'Only UNKNOWN can be verified');
    requireCondition(ready.verifierAvailable, 'NotEligible', 'No verifier registered');
  } else if (op.status === 'UNKNOWN') {
    requireCondition(isReplaySafe(op.policySnapshot.replay, {
      now, firstExecutionAt: op.firstExecutionAt, idempotencyKey: op.idempotencyKey,
      contractVersion: ready.replayContractVersion, clockTrusted: ready.clockTrusted,
    }), 'UnsafeReplay', 'Replay has no valid backend guarantee');
  }
  const count = command.action === 'execution' ? op.executionCount : op.verificationCount;
  const policy = op.policySnapshot[command.action];
  requireCondition(count < policy.maxAttempts, 'BudgetExhausted', 'Attempt budget exhausted');
  nonEmpty(command.attemptId, 'attemptId'); nonEmpty(command.ownerId, 'ownerId');
  integer(command.leaseDurationMs, 'leaseDurationMs', 1);
  const fence = op.fence + 1; integer(fence, 'fence');
  const activeAttempt = Object.freeze({ id: command.attemptId, kind: command.action, ordinal: count + 1, startedAt: now, deadlineAt: addTime(now, policy.timeoutMs) });
  const lease = Object.freeze({ ownerId: command.ownerId, fence, expiresAt: addTime(now, command.leaseDurationMs) });
  const base = { ...op, activeAttempt, lease, fence, schedule: null, holdReason: null, completion: null, failure: null };
  return command.action === 'execution'
    ? { ...base, status: 'EXECUTING', executionCount: count + 1, firstExecutionAt: op.firstExecutionAt ?? now }
    : { ...base, status: 'VERIFYING', unresolvedEffect: true, verificationCount: count + 1 };
}

function unknown(op: Operation, now: number, sample: number, retryAfterAt?: number): Operation {
  const policy = op.policySnapshot.verification;
  return idle(op, 'UNKNOWN', op.verificationCount < policy.maxAttempts
    ? Object.freeze({ kind: 'verification', at: nextRetryAt(policy, Math.max(1, op.verificationCount), now, sample, retryAfterAt) })
    : null);
}

function resolveRejection(op: Operation, evidence: Evidence, command: ResolveCommand, now: number): Operation {
  requireCondition(evidence.source === 'BACKEND', 'InvalidEvidence', 'Backend rejection evidence required');
  if (command.kind === 'VERIFICATION_RESULT') globalBackend(evidence);
  if (evidence.scope === 'OPERATION' || !op.unresolvedEffect) {
    return failed(op, { kind: 'BUSINESS_REJECTION', code: evidence.code });
  }
  return unknown(op, now, command.jitterSample, command.retryAfterAt);
}

function resolve(op: Operation, command: ResolveCommand, now: number): Operation {
  const execution = command.kind === 'EXECUTION_RESULT';
  requireCondition(op.status === (execution ? 'EXECUTING' : 'VERIFYING'), 'InvalidOperationTransition', 'Result kind does not match active state');
  assertOwner(op, command.ownership, now);
  const result = command.result;
  const kinds = execution
    ? ['CONFIRMED_COMPLETED', 'CONFIRMED_REJECTED', 'NOT_APPLIED', 'AMBIGUOUS']
    : ['CONFIRMED_COMPLETED', 'CONFIRMED_REJECTED', 'FINAL_NOT_APPLIED', 'PENDING', 'INCONCLUSIVE'];
  requireCondition(kinds.includes(result.kind), 'InvalidEvidence', 'Result is not valid for this attempt kind');
  const evidence = checkedEvidence(op, result.evidence);
  const base = { ...op, lastEvidence: evidence };
  if (result.kind === 'CONFIRMED_COMPLETED') {
    globalBackend(evidence);
    return { ...base, status: 'COMPLETED', unresolvedEffect: false, activeAttempt: null, lease: null, schedule: null, holdReason: null, failure: null,
      completion: Object.freeze({ evidence, result: snapshotJson(result.result, command.resultLimits) }) };
  }
  if (result.kind === 'CONFIRMED_REJECTED') {
    return resolveRejection(base, evidence, command, now);
  }
  if (result.kind === 'AMBIGUOUS' || result.kind === 'PENDING' || result.kind === 'INCONCLUSIVE') {
    // Only schedule a read; a replay still requires an explicit guarded claim.
    return unknown(base, now, command.jitterSample, command.retryAfterAt);
  }
  if (result.kind === 'FINAL_NOT_APPLIED') globalBackend(evidence);
  else requireCondition(result.kind === 'NOT_APPLIED' && evidence.scope === 'ATTEMPT', 'InvalidEvidence', 'No-effect execution evidence must be attempt-scoped');
  requireCondition(typeof result.retryable === 'boolean', 'InvalidEvidence', 'No-effect result must specify retryability');
  if (execution && op.unresolvedEffect) return unknown(base, now, command.jitterSample, command.retryAfterAt);
  if (!result.retryable) return failed(base, { kind: 'NOT_RETRYABLE', code: evidence.code });
  if (op.executionCount >= op.policySnapshot.execution.maxAttempts) return failed(base, { kind: 'BUDGET_EXHAUSTED', code: evidence.code });
  return idle(base, 'ACCEPTED', Object.freeze({ kind: 'execution', at: nextRetryAt(op.policySnapshot.execution, op.executionCount, now, command.jitterSample, command.retryAfterAt) }));
}

export function transition(op: Operation, command: OperationCommand, context: MutationContext): OperationChange {
  assertOperationInvariants(op);
  integer(context.now, 'now'); nonEmpty(context.mutationId, 'mutationId');
  requireCondition(context.expectedRevision === op.revision, 'RevisionConflict', 'Revision changed');
  requireCondition(context.principalScope === op.principalScope && context.targetScope === op.targetScope, 'ScopeMismatch', 'Mutation scope mismatch');
  requireCondition(op.status !== 'COMPLETED' && op.status !== 'FAILED', 'InvalidOperationTransition', 'Terminal operations cannot change');
  let next: Operation;
  switch (command.kind) {
    case 'CLAIM': next = claim(op, command, context.now); break;
    case 'EXECUTION_RESULT': case 'VERIFICATION_RESULT': next = resolve(op, command, context.now); break;
    case 'RECOVER_EXPIRED': {
      requireCondition(op.status === 'EXECUTING' || op.status === 'VERIFYING', 'InvalidOperationTransition', 'Only active work can be recovered');
      requireCondition(context.now >= op.lease.expiresAt, 'NotEligible', 'Lease has not expired');
      next = { ...unknown(op, context.now, command.jitterSample), fence: op.fence + 1 };
      break;
    }
    case 'RENEW': {
      assertOwner(op, command.ownership, context.now);
      requireCondition(op.status === 'EXECUTING' || op.status === 'VERIFYING', 'InvalidOperationTransition', 'Only active leases can renew');
      integer(command.leaseDurationMs, 'leaseDurationMs', 1);
      const expiresAt = addTime(context.now, command.leaseDurationMs);
      requireCondition(expiresAt > op.lease.expiresAt, 'NotEligible', 'Renewal must extend the lease');
      next = { ...op, lease: Object.freeze({ ...op.lease, expiresAt }) };
      break;
    }
    case 'FAIL_LOCAL': {
      requireCondition(op.status === 'ACCEPTED', 'InvalidOperationTransition', 'Local failure requires resolved idle work');
      nonEmpty(command.code, 'failure.code');
      requireCondition(command.reason === 'LOCAL_REJECTION' || command.reason === 'BUDGET_EXHAUSTED', 'InvalidInput', 'Invalid local failure reason');
      requireCondition(command.reason !== 'BUDGET_EXHAUSTED' || op.executionCount >= op.policySnapshot.execution.maxAttempts, 'NotEligible', 'Execution budget remains');
      next = failed(op, { kind: command.reason, code: command.code });
      break;
    }
    case 'SCHEDULE': {
      requireCondition(op.status === 'ACCEPTED' || op.status === 'UNKNOWN', 'InvalidOperationTransition', 'Only idle work can be scheduled');
      if (command.schedule !== null) {
        const kind = command.schedule.kind;
        integer(command.schedule.at, 'schedule.at');
        requireCondition(op.schedule === null || command.schedule.at >= op.schedule.at, 'NotEligible', 'Cannot bypass the persisted backoff');
        requireCondition(kind === 'execution' || kind === 'verification', 'InvalidInput', 'Invalid schedule kind');
        requireCondition(op.status !== 'ACCEPTED' || kind === 'execution', 'InvalidOperationTransition', 'ACCEPTED cannot verify');
        const count = kind === 'execution' ? op.executionCount : op.verificationCount;
        requireCondition(count < op.policySnapshot[kind].maxAttempts, 'BudgetExhausted', 'Scheduled action has no budget');
        if (count > 0 && op.schedule?.kind !== kind) {
          const minimum = nextRetryAt(op.policySnapshot[kind], count, op.updatedAt, command.jitterSample);
          requireCondition(command.schedule.at >= minimum, 'NotEligible', 'Cannot bypass retry backoff');
        }
      }
      requireCondition(command.schedule !== null || op.schedule === null || command.holdReason !== null, 'NotEligible', 'Use a hold to suspend scheduled work');
      // A hold retains its due date, including backend Retry-After constraints.
      next = { ...op, schedule: command.schedule === null ? op.schedule : Object.freeze({ ...command.schedule }), holdReason: command.holdReason };
      break;
    }
    default: requireCondition(false, 'InvalidOperationTransition', 'Unknown transition command');
  }
  const changed = next.status !== op.status;
  requireCondition(!changed || ALLOWED_TRANSITIONS[op.status].includes(next.status), 'InvalidOperationTransition', 'Transition is not in the state machine');
  next = Object.freeze({ ...next, revision: op.revision + 1, updatedAt: context.now });
  assertOperationInvariants(next);
  return Object.freeze({ operation: next, expectedRevision: op.revision, mutationId: context.mutationId,
    event: changed ? Object.freeze({ operationId: op.id, revision: next.revision, mutationId: context.mutationId,
      from: op.status, to: next.status, occurredAt: context.now, trigger: command.kind,
      attemptId: next.activeAttempt?.id ?? op.activeAttempt?.id ?? null }) : null,
  });
}
