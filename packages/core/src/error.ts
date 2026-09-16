export type ErrorCategory =
  | 'ADMISSION' | 'STORAGE' | 'CONCURRENCY' | 'PREPARATION'
  | 'TRANSPORT' | 'BUSINESS' | 'VERIFICATION' | 'CONTRACT' | 'TELEMETRY';

export interface OperationError {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly certainty: 'NOT_APPLIED' | 'UNKNOWN' | 'NOT_APPLICABLE';
  readonly scope: 'ATTEMPT' | 'OPERATION' | 'LOCAL';
  readonly action: 'REJECT' | 'RECONCILE' | 'RELOAD' | 'HOLD' | 'RETRY_IF_SAFE' | 'IGNORE';
  readonly operationId?: string;
  readonly message: string;
}

export type DomainErrorCode =
  | 'InvalidInput' | 'InvalidOperationTransition' | 'InvalidOperationInvariant'
  | 'RevisionConflict' | 'LeaseLost' | 'StaleAttempt' | 'ScopeMismatch'
  | 'UnsafeReplay' | 'BudgetExhausted' | 'NotEligible' | 'InvalidEvidence';

export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export function requireCondition(
  condition: unknown, code: DomainErrorCode, message: string,
): asserts condition {
  if (!condition) throw new DomainError(code, message);
}

export function integer(value: number, label: string, minimum = 0): void {
  requireCondition(Number.isSafeInteger(value) && value >= minimum, 'InvalidInput', `${label} must be a safe integer >= ${minimum}`);
}

export function nonEmpty(value: string, label: string): void {
  requireCondition(typeof value === 'string' && value.trim().length > 0, 'InvalidInput', `${label} must not be empty`);
}

export function addTime(now: number, duration: number): number {
  integer(now, 'now');
  integer(duration, 'duration');
  const result = now + duration;
  integer(result, 'timestamp');
  return result;
}
