import { operationId, proposeAcceptance, transition } from '../dist/index.js';

export const limits = { maxBytes: 4096, maxDepth: 12 };
export const policy = {
  execution: { maxAttempts: 3, timeoutMs: 100, baseDelayMs: 10, maxDelayMs: 100 },
  verification: { maxAttempts: 3, timeoutMs: 100, baseDelayMs: 10, maxDelayMs: 100 },
  replay: { kind: 'NONE' },
};
export function input(overrides = {}) {
  return { id: operationId('op-1'), type: 'payment.create', definitionVersion: '1',
    payload: { amount: 10, currency: 'COP' }, principalScope: 'account-1', targetScope: 'production',
    idempotencyKey: null, policySnapshot: structuredClone(policy), ...overrides };
}
export function accepted(overrides = {}) {
  return proposeAcceptance(input(overrides), 1000, 'accept-1', limits).operation;
}
export function context(op, overrides = {}) {
  return { mutationId: `mutation-${op.revision + 1}`, expectedRevision: op.revision,
    principalScope: op.principalScope, targetScope: op.targetScope, now: op.updatedAt + 20, ...overrides };
}
export function apply(op, command, overrides = {}) {
  return transition(op, command, context(op, overrides)).operation;
}
export function claimCommand(op, action = 'execution', overrides = {}) {
  return { kind: 'CLAIM', action, attemptId: `attempt-${op.fence + 1}`, ownerId: 'worker-A', leaseDurationMs: 200,
    readiness: { principalScope: op.principalScope, targetScope: op.targetScope,
      definitionVersion: op.definitionVersion, credentialsReady: true, definitionReady: true,
      verifierAvailable: true, replayContractVersion: op.policySnapshot.replay.contractVersion ?? null, clockTrusted: true }, ...overrides };
}
export function claim(op = accepted(), action = 'execution') { return apply(op, claimCommand(op, action)); }
export function owner(op) { return { ownerId: op.lease.ownerId, fence: op.lease.fence, attemptId: op.activeAttempt.id }; }
export function evidence(op, overrides = {}) {
  return { operationId: op.id, attemptId: op.activeAttempt.id, source: 'BACKEND', scope: 'OPERATION', observedAt: op.updatedAt + 10, code: 'CONFIRMED', ...overrides };
}
export function resultCommand(op, result = {}, overrides = {}) {
  return { kind: op.status === 'EXECUTING' ? 'EXECUTION_RESULT' : 'VERIFICATION_RESULT', ownership: owner(op),
    result: { kind: 'CONFIRMED_COMPLETED', evidence: evidence(op), result: { remoteId: 'payment-1' }, ...result },
    jitterSample: 1, resultLimits: limits, ...overrides };
}
export function unknown(overrides = {}) {
  const op = claim(accepted(overrides));
  return apply(op, resultCommand(op, { kind: 'AMBIGUOUS' }));
}
export function verifying(overrides = {}) { return claim(unknown(overrides), 'verification'); }
export function schedule(op, kind, at = op.updatedAt + 100) {
  return apply(op, { kind: 'SCHEDULE', schedule: { kind, at }, holdReason: null, jitterSample: 1 });
}
