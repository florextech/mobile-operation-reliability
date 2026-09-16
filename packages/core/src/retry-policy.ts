import { addTime, integer, nonEmpty, requireCondition } from './error.js';

export interface AttemptPolicy {
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export type ReplayGuarantee =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'IDEMPOTENT'; readonly contractVersion: string }
  | { readonly kind: 'DEDUPLICATED'; readonly contractVersion: string; readonly retentionMs: number; readonly safetyMarginMs: number };

export interface RetryPolicy {
  readonly execution: AttemptPolicy;
  readonly verification: AttemptPolicy;
  readonly replay: ReplayGuarantee;
}

export function validateRetryPolicy(policy: RetryPolicy): void {
  for (const [kind, rule] of Object.entries({ execution: policy.execution, verification: policy.verification })) {
    integer(rule.maxAttempts, `${kind}.maxAttempts`, kind === 'execution' ? 1 : 0);
    integer(rule.timeoutMs, `${kind}.timeoutMs`, 1);
    integer(rule.baseDelayMs, `${kind}.baseDelayMs`);
    integer(rule.maxDelayMs, `${kind}.maxDelayMs`);
    requireCondition(rule.baseDelayMs <= rule.maxDelayMs, 'InvalidInput', 'baseDelayMs exceeds maxDelayMs');
  }
  const replay = policy.replay;
  requireCondition(['NONE', 'IDEMPOTENT', 'DEDUPLICATED'].includes(replay.kind), 'InvalidInput', 'Unknown replay guarantee');
  if (replay.kind !== 'NONE') nonEmpty(replay.contractVersion, 'contractVersion');
  if (replay.kind === 'DEDUPLICATED') {
    integer(replay.retentionMs, 'retentionMs', 1);
    integer(replay.safetyMarginMs, 'safetyMarginMs');
    requireCondition(replay.safetyMarginMs < replay.retentionMs, 'InvalidInput', 'Replay margin must be less than retention');
  }
}

export function nextRetryAt(policy: AttemptPolicy, attempts: number, now: number, sample: number, retryAfterAt?: number): number {
  integer(attempts, 'attempts', 1);
  integer(policy.baseDelayMs, 'baseDelayMs');
  integer(policy.maxDelayMs, 'maxDelayMs');
  requireCondition(policy.baseDelayMs <= policy.maxDelayMs, 'InvalidInput', 'Invalid backoff range');
  requireCondition(Number.isFinite(sample) && sample >= 0 && sample <= 1, 'InvalidInput', 'Jitter sample must be between 0 and 1');
  // The cap avoids overflow even after many crash-reserved attempts.
  const cap = policy.baseDelayMs === 0 ? 0 : Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.min(attempts - 1, 1023));
  const due = addTime(now, Math.floor(cap * sample));
  if (retryAfterAt === undefined) return due;
  integer(retryAfterAt, 'retryAfterAt');
  return Math.max(due, retryAfterAt);
}

export interface ReplayContext {
  readonly now: number;
  readonly firstExecutionAt: number | null;
  readonly idempotencyKey: string | null;
  /** Attestation by the versioned integration, not evidence inferred from HTTP. */
  readonly contractVersion: string | null;
  readonly clockTrusted: boolean;
}

export function isReplaySafe(guarantee: ReplayGuarantee, context: ReplayContext): boolean {
  integer(context.now, 'now');
  if (guarantee.kind === 'NONE' || guarantee.contractVersion !== context.contractVersion) return false;
  if (guarantee.kind === 'IDEMPOTENT') return true;
  if (!context.clockTrusted || !context.idempotencyKey || context.firstExecutionAt === null) return false;
  integer(context.firstExecutionAt, 'firstExecutionAt');
  const elapsed = context.now - context.firstExecutionAt;
  return elapsed >= 0 && elapsed < guarantee.retentionMs - guarantee.safetyMarginMs;
}
