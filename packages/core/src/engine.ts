import { proposeAcceptance } from './state-machine.js';
import type { ClockPort, MutationResult, NetworkPort, OperationKey, ReadResult, StoragePort, TelemetryPort, TransportPort, TransportResponse, Unsubscribe } from './ports.js';
import type { ExecutionResult, Operation, OperationId, OperationInput, OperationScope, VerificationResult } from './operation.js';
import type { PayloadLimits } from './json.js';

export interface EngineIdentifiers {
  readonly ownerId: string;
  nextMutationId(): string;
  nextAttemptId(): string;
}

export interface OperationEngineOptions {
  readonly storage: StoragePort;
  readonly transport: TransportPort;
  readonly clock: Pick<ClockPort, 'wallNow'>;
  readonly limits: PayloadLimits;
  readonly identifiers: EngineIdentifiers;
  readonly leaseDurationMs: number;
  /** Renew an owned lease this long before expiry; must be below leaseDurationMs. */
  readonly leaseRenewalLeadMs?: number;
  readonly isDefinitionReady: (operation: Operation) => boolean;
  readonly areCredentialsReady: (operation: Operation) => boolean;
  /** No verifier is assumed unless the integration explicitly registers one. */
  readonly isVerifierAvailable?: (operation: Operation) => boolean;
  /** Backend attestation required before replaying an unresolved execution. */
  readonly replayContractVersion?: (operation: Operation) => string | null;
  readonly isClockTrusted?: () => boolean;
  /** A deterministic sample, normally supplied by the runtime composition. */
  readonly nextJitterSample: () => number;
  /** Offline suppresses new claims; unknown remains eligible because it is only a hint. */
  readonly network?: NetworkPort;
  readonly telemetry?: TelemetryPort;
}

export class OperationTerminalError extends Error {
  constructor(readonly operation: Operation) {
    super(`Operation ${operation.id} ended as ${operation.status}`);
    this.name = 'OperationTerminalError';
  }
}

export class OperationAcceptanceError extends Error {
  constructor(readonly result: Exclude<MutationResult, { readonly kind: 'COMMITTED' }>) {
    super(`Operation acceptance did not commit: ${result.kind}`);
    this.name = 'OperationAcceptanceError';
  }
}

type Listener = (operation: Operation) => void;

/** Coordinates durable claims and exactly one transport call per committed claim. */
export class OperationEngine {
  private readonly listeners = new Map<OperationId, Set<Listener>>();
  private readonly handles = new Map<OperationId, OperationHandle>();
  private readonly options: OperationEngineOptions;

  constructor(options: OperationEngineOptions) {
    const lead = options.leaseRenewalLeadMs ?? Math.floor(options.leaseDurationMs / 2);
    if (!Number.isSafeInteger(options.leaseDurationMs) || options.leaseDurationMs < 1 || !Number.isSafeInteger(lead) || lead < 0 || lead >= options.leaseDurationMs) {
      throw new RangeError('Invalid lease configuration');
    }
    this.options = options;
  }

  async execute(input: OperationInput): Promise<OperationHandle> {
    const proposal = proposeAcceptance(input, this.options.clock.wallNow(), this.options.identifiers.nextMutationId(), this.options.limits);
    const result = await this.options.storage.accept(proposal);
    if (result.kind === 'COMMITTED' || result.kind === 'EXISTING') {
      this.publish(result.operation);
      return this.handle(result.operation);
    }
    throw new OperationAcceptanceError(result);
  }

  handle(key: OperationKey): OperationHandle {
    const existing = this.handles.get(key.id);
    if (existing) return existing;
    const handle = new OperationHandle(this, key);
    this.handles.set(key.id, handle);
    return handle;
  }

  async status(key: OperationKey): Promise<ReadResult<Operation | null>> {
    return this.options.storage.get(key);
  }

  async runOnce(scope: OperationScope, limit = 100): Promise<void> {
    const page = await this.options.storage.scanWork({ ...scope, cursor: null, limit });
    if (page.kind === 'ERROR') return;
    for (const operation of page.value.items) {
      if (operation.status === 'EXECUTING' || operation.status === 'VERIFYING') await this.maintainLease(operation);
      else if (operation.status === 'UNKNOWN' && operation.schedule?.kind === 'verification') await this.verifyCandidate(operation);
      else await this.executeCandidate(operation);
    }
  }

  private async executeCandidate(operation: Operation): Promise<void> {
    if (this.options.network?.getSnapshot() === 'offline') return;
    if ((operation.status !== 'ACCEPTED' && operation.status !== 'UNKNOWN') || operation.schedule?.kind !== 'execution' || operation.schedule.at > this.options.clock.wallNow()) return;
    const claim = await this.options.storage.claim({
      key: keyFor(operation),
      context: contextFor(operation, this.options.identifiers.nextMutationId(), this.options.clock.wallNow()),
      command: {
        kind: 'CLAIM', action: 'execution', attemptId: this.options.identifiers.nextAttemptId(), ownerId: this.options.identifiers.ownerId,
        leaseDurationMs: this.options.leaseDurationMs,
        readiness: {
          principalScope: operation.principalScope, targetScope: operation.targetScope, definitionVersion: operation.definitionVersion,
          definitionReady: this.options.isDefinitionReady(operation), credentialsReady: this.options.areCredentialsReady(operation),
          verifierAvailable: this.options.isVerifierAvailable?.(operation) ?? false,
          replayContractVersion: this.options.replayContractVersion?.(operation) ?? null,
          clockTrusted: this.options.isClockTrusted?.() ?? false,
        },
      },
    });
    if (claim.kind !== 'COMMITTED') return;
    this.publish(claim.operation);
    const active = claim.operation;
    if (active.status !== 'EXECUTING') return;
    const result = await this.transportResult(active);
    const committed = await this.options.storage.commitTransition({
      key: keyFor(active), context: contextFor(active, this.options.identifiers.nextMutationId(), this.options.clock.wallNow()),
      command: {
        kind: 'EXECUTION_RESULT', ownership: { ownerId: active.lease.ownerId, fence: active.lease.fence, attemptId: active.activeAttempt.id },
        result: result.result, jitterSample: this.options.nextJitterSample(), resultLimits: this.options.limits,
        ...(result.retryAfterAt === undefined ? {} : { retryAfterAt: result.retryAfterAt }),
      },
    });
    if (committed.kind === 'COMMITTED') this.publish(committed.operation);
  }

  private async verifyCandidate(operation: Extract<Operation, { readonly status: 'UNKNOWN' }>): Promise<void> {
    const verify = this.options.transport.verify?.bind(this.options.transport);
    const schedule = operation.schedule;
    if (this.options.network?.getSnapshot() === 'offline' || !verify || !(this.options.isVerifierAvailable?.(operation) ?? false) || schedule?.kind !== 'verification' || schedule.at > this.options.clock.wallNow()) return;
    const claim = await this.options.storage.claim({
      key: keyFor(operation), context: contextFor(operation, this.options.identifiers.nextMutationId(), this.options.clock.wallNow()),
      command: {
        kind: 'CLAIM', action: 'verification', attemptId: this.options.identifiers.nextAttemptId(), ownerId: this.options.identifiers.ownerId,
        leaseDurationMs: this.options.leaseDurationMs,
        readiness: {
          principalScope: operation.principalScope, targetScope: operation.targetScope, definitionVersion: operation.definitionVersion,
          definitionReady: this.options.isDefinitionReady(operation), credentialsReady: this.options.areCredentialsReady(operation),
          verifierAvailable: true, replayContractVersion: this.options.replayContractVersion?.(operation) ?? null,
          clockTrusted: this.options.isClockTrusted?.() ?? false,
        },
      },
    });
    if (claim.kind !== 'COMMITTED' || claim.operation.status !== 'VERIFYING') return;
    this.publish(claim.operation);
    const result = await this.verificationResult(claim.operation, verify);
    const committed = await this.options.storage.commitTransition({
      key: keyFor(claim.operation), context: contextFor(claim.operation, this.options.identifiers.nextMutationId(), this.options.clock.wallNow()),
      command: {
        kind: 'VERIFICATION_RESULT', ownership: { ownerId: claim.operation.lease.ownerId, fence: claim.operation.lease.fence, attemptId: claim.operation.activeAttempt.id },
        result: result.result, jitterSample: this.options.nextJitterSample(), resultLimits: this.options.limits,
        ...(result.retryAfterAt === undefined ? {} : { retryAfterAt: result.retryAfterAt }),
      },
    });
    if (committed.kind === 'COMMITTED') this.publish(committed.operation);
  }

  private async maintainLease(operation: Extract<Operation, { readonly status: 'EXECUTING' | 'VERIFYING' }>): Promise<void> {
    const now = this.options.clock.wallNow();
    if (now >= operation.lease.expiresAt) {
      const recovered = await this.options.storage.recoverExpired({
        key: keyFor(operation), context: contextFor(operation, this.options.identifiers.nextMutationId(), now),
        command: { kind: 'RECOVER_EXPIRED', jitterSample: this.options.nextJitterSample() },
      });
      if (recovered.kind === 'COMMITTED') this.publish(recovered.operation);
      return;
    }
    const lead = this.options.leaseRenewalLeadMs ?? Math.floor(this.options.leaseDurationMs / 2);
    if (operation.lease.ownerId !== this.options.identifiers.ownerId || now < operation.lease.expiresAt - lead) return;
    const renewed = await this.options.storage.renew({
      key: keyFor(operation), context: contextFor(operation, this.options.identifiers.nextMutationId(), now),
      command: {
        kind: 'RENEW', ownership: { ownerId: operation.lease.ownerId, fence: operation.lease.fence, attemptId: operation.activeAttempt.id },
        leaseDurationMs: this.options.leaseDurationMs,
      },
    });
    if (renewed.kind === 'COMMITTED') this.publish(renewed.operation);
  }

  private async transportResult(operation: Extract<Operation, { readonly status: 'EXECUTING' }>): Promise<TransportResponse<ExecutionResult>> {
    try {
      return await this.options.transport.execute({ operation, attemptId: operation.activeAttempt.id, deadlineAt: operation.activeAttempt.deadlineAt });
    } catch {
      return {
        result: { kind: 'AMBIGUOUS', evidence: {
          operationId: operation.id, attemptId: operation.activeAttempt.id, source: 'LOCAL', scope: 'ATTEMPT',
          observedAt: this.options.clock.wallNow(), code: 'TRANSPORT_EXCEPTION',
        } },
      };
    }
  }

  private async verificationResult(operation: Extract<Operation, { readonly status: 'VERIFYING' }>, verify: NonNullable<TransportPort['verify']>): Promise<TransportResponse<VerificationResult>> {
    try {
      return await verify({ operation, attemptId: operation.activeAttempt.id, deadlineAt: operation.activeAttempt.deadlineAt });
    } catch {
      return { result: { kind: 'INCONCLUSIVE', evidence: {
        operationId: operation.id, attemptId: operation.activeAttempt.id, source: 'LOCAL', scope: 'ATTEMPT',
        observedAt: this.options.clock.wallNow(), code: 'VERIFICATION_EXCEPTION',
      } } };
    }
  }

  subscribe(id: OperationId, listener: Listener): () => void {
    const listeners = this.listeners.get(id) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(id);
    };
  }

  private publish(operation: Operation): void {
    for (const listener of this.listeners.get(operation.id) ?? []) listener(operation);
    try {
      this.options.telemetry?.emit({ operationId: operation.id, revision: operation.revision, status: operation.status, kind: 'TRANSITION' });
    } catch {
      // Telemetry is explicitly outside the durable execution boundary.
    }
  }
}

export class OperationHandle {
  constructor(private readonly engine: OperationEngine, readonly key: OperationKey) {}
  get id(): OperationId { return this.key.id; }
  status(): Promise<ReadResult<Operation | null>> { return this.engine.status(this.key); }
  async confirmed(): Promise<Extract<Operation, { readonly status: 'COMPLETED' }>> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (operation: Operation) => {
        if (settled) return;
        if (operation.status !== 'COMPLETED' && operation.status !== 'FAILED') return;
        settled = true;
        unsubscribe();
        if (operation.status === 'COMPLETED') resolve(operation);
        else reject(new OperationTerminalError(operation));
      };
      const unsubscribe = this.engine.subscribe(this.id, finish);
      void this.status().then(current => {
        if (current.kind === 'ERROR') {
          if (!settled) { settled = true; unsubscribe(); reject(new OperationAcceptanceError({ kind: 'ERROR', error: current.error })); }
          return;
        }
        if (current.value) finish(current.value);
      }).catch(error => {
        if (!settled) { settled = true; unsubscribe(); reject(error); }
      });
    });
  }
}

/** A lightweight, caller-driven scheduler; a wake never confers execution permission. */
export class OperationScheduler {
  constructor(private readonly engine: OperationEngine, private readonly scope: OperationScope, private readonly clock: Pick<ClockPort, 'scheduleWake'>, private readonly network?: NetworkPort) {}
  run(): Promise<void> { return this.engine.runOnce(this.scope); }
  wake(delayMs: number): () => void { return this.clock.scheduleWake(delayMs, () => { void this.run(); }); }
  /** Reconnect is only a prompt to re-read durable work; it does not bypass due time. */
  start(): Unsubscribe {
    if (!this.network) return () => {};
    return this.network.subscribe(state => { if (state === 'online') void this.run(); });
  }
}

function keyFor(operation: Operation): OperationKey {
  return { id: operation.id, principalScope: operation.principalScope, targetScope: operation.targetScope };
}
function contextFor(operation: Operation, mutationId: string, now: number) {
  return { ...keyFor(operation), mutationId, expectedRevision: operation.revision, now };
}
