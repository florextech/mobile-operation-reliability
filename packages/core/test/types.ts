import type { Operation, OperationId, OperationStatus, TelemetryEvent, StoragePort, TransportPort } from '../src/index.js';

export function checkReadonly(op: Operation): void {
  // @ts-expect-error An accepted payload cannot be replaced.
  op.payload = {};
  // @ts-expect-error Retry budgets cannot be reset by callers.
  op.policySnapshot.execution.maxAttempts = 10;
  if (op.status === 'FAILED') {
    // @ts-expect-error FAILED cannot have an unresolved effect.
    const uncertainty: true = op.unresolvedEffect;
    void uncertainty;
  }
  // @ts-expect-error State is not publicly mutable.
  op.status = 'COMPLETED';
}
// @ts-expect-error IDs must cross the validated identity boundary.
export const invalidId: OperationId = 'raw';
// @ts-expect-error Legacy state is not part of the domain.
export const legacyStatus: OperationStatus = 'QUEUED';
export function checkTelemetry(event: TelemetryEvent): void {
  // @ts-expect-error Raw payload cannot be exported in telemetry.
  event.payload = {};
}
export function checkPorts(store: StoragePort, transport: TransportPort): void {
  // @ts-expect-error No blind storage save operation.
  store.save({});
  // @ts-expect-error No independent event append.
  store.appendEvent({});
  // @ts-expect-error Transport cannot change lifecycle state.
  transport.transition('FAILED');
}
