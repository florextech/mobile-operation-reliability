import type { OperationError } from './error.js';
import type { AcceptanceChange, Operation, OperationChange, OperationEvent, OperationId, OperationScope, ExecutionResult, VerificationResult } from './operation.js';
import type { ClaimCommand, MutationContext, OperationCommand } from './state-machine.js';

export type ReadResult<T> = { readonly kind: 'OK'; readonly value: T } | { readonly kind: 'ERROR'; readonly error: OperationError };
export type MutationResult =
  | { readonly kind: 'COMMITTED'; readonly operation: Operation; readonly mutationId: string }
  | { readonly kind: 'CONFLICT'; readonly code: 'RevisionConflict' | 'LeaseLost' | 'StaleAttempt' | 'IdentityConflict' | 'NotEligible' }
  | { readonly kind: 'INDETERMINATE'; readonly operationId: OperationId; readonly mutationId: string }
  | { readonly kind: 'ERROR'; readonly error: OperationError };
export type AcceptanceResult = MutationResult
  | { readonly kind: 'EXISTING'; readonly operation: Operation };
export interface OperationKey extends OperationScope { readonly id: OperationId }
export interface Page<T> { readonly items: readonly T[]; readonly nextCursor: string | null }
export interface PageQuery extends OperationScope { readonly cursor: string | null; readonly limit: number }
export interface MutationRequest<C extends OperationCommand = OperationCommand> {
  readonly key: OperationKey;
  readonly context: MutationContext;
  readonly command: C;
}

/** All mutation methods must revalidate against the current row within a durable
 * transaction, apply the pure state machine, and persist its event atomically.
 * Repeating a mutationId returns its original outcome without applying it twice.
 * Candidate reads confer no permission to execute. */
export interface StoragePort {
  open(expectedSchemaVersion: 1): Promise<ReadResult<void>>;
  /** Accept only an initial proposal; validate identity, scopes and key uniqueness.
   * COMMITTED/EXISTING certify durability; a proposal alone does not. */
  accept(proposal: AcceptanceChange): Promise<AcceptanceResult>;
  get(key: OperationKey): Promise<ReadResult<Operation | null>>;
  scanWork(query: PageQuery): Promise<ReadResult<Page<Operation>>>;
  claim(request: MutationRequest<ClaimCommand>): Promise<MutationResult>;
  renew(request: MutationRequest<Extract<OperationCommand, { kind: 'RENEW' }>>): Promise<MutationResult>;
  commitTransition(request: MutationRequest<Extract<OperationCommand, { kind: 'EXECUTION_RESULT' | 'VERIFICATION_RESULT' | 'FAIL_LOCAL' }>>): Promise<MutationResult>;
  recoverExpired(request: MutationRequest<Extract<OperationCommand, { kind: 'RECOVER_EXPIRED' }>>): Promise<MutationResult>;
  updateScheduling(request: MutationRequest<Extract<OperationCommand, { kind: 'SCHEDULE' }>>): Promise<MutationResult>;
  /** Resolves an ambiguous mutation even if later mutations changed the row. */
  getMutation(key: OperationKey, mutationId: string): Promise<ReadResult<OperationChange | null>>;
  readEvents(key: OperationKey, page: { readonly cursor: string | null; readonly limit: number }): Promise<ReadResult<Page<OperationEvent>>>;
  close(): Promise<ReadResult<void>>;
}

export interface TransportContext<S extends 'EXECUTING' | 'VERIFYING'> {
  readonly operation: Extract<Operation, { status: S }>;
  readonly attemptId: string;
  readonly deadlineAt: number;
}
/** Retry-After is an adapter assertion about when a later attempt may occur;
 * it is never evidence about the business outcome. */
export interface TransportResponse<R> {
  readonly result: R;
  readonly retryAfterAt?: number;
}
/** One execution call authorizes at most one mutation attempt; no hidden retries.
 * Results assert evidence, never dictate lifecycle or write storage. */
export interface TransportPort {
  execute(context: TransportContext<'EXECUTING'>): Promise<TransportResponse<ExecutionResult>>;
  verify?(context: TransportContext<'VERIFYING'>): Promise<TransportResponse<VerificationResult>>;
}

export type NetworkState = 'online' | 'offline' | 'unknown';
export type Unsubscribe = () => void;
export interface NetworkPort {
  getSnapshot(): NetworkState;
  subscribe(listener: (state: NetworkState) => void): Unsubscribe;
}
export interface ClockPort {
  wallNow(): number;
  monotonicNow(): number;
  scheduleWake(delayMs: number, callback: () => void): Unsubscribe;
}
export interface TelemetryEvent {
  readonly operationId: OperationId;
  readonly revision: number;
  readonly status: Operation['status'];
  readonly kind: 'TRANSITION' | 'DIAGNOSTIC';
  readonly ordinal?: number;
  readonly durationMs?: number;
  readonly code?: string;
}
/** Non-blocking, bounded, best effort. Never part of the commit boundary. */
export interface TelemetryPort { emit(event: TelemetryEvent): void }
