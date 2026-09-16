import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_TRANSITIONS, OPERATION_STATUSES, DomainError, transition, assertOperationInvariants } from '../dist/index.js';
import { accepted, apply, claim, claimCommand, context, evidence, owner, policy, resultCommand, schedule, unknown, verifying } from './helpers.mjs';

const errorCode = (fn, code) => assert.throws(fn, error => error instanceof DomainError && error.code === code);
const replayPolicy = { ...policy, replay: { kind: 'IDEMPOTENT', contractVersion: '1' } };
const noEffect = op => ({ kind: 'NOT_APPLIED', evidence: evidence(op, { scope: 'ATTEMPT', source: 'LOCAL' }), retryable: true });

const routes = [
  ['ACCEPTED', 'EXECUTING', () => { const op = accepted(); return [op, claimCommand(op)]; }],
  ['ACCEPTED', 'FAILED', () => [accepted(), { kind: 'FAIL_LOCAL', reason: 'LOCAL_REJECTION', code: 'REJECTED' }]],
  ['EXECUTING', 'ACCEPTED', () => { const op = claim(); return [op, resultCommand(op, noEffect(op))]; }],
  ['EXECUTING', 'UNKNOWN', () => { const op = claim(); return [op, resultCommand(op, { kind: 'AMBIGUOUS' })]; }],
  ['EXECUTING', 'COMPLETED', () => { const op = claim(); return [op, resultCommand(op)]; }],
  ['EXECUTING', 'FAILED', () => { const op = claim(); return [op, resultCommand(op, { kind: 'CONFIRMED_REJECTED' })]; }],
  ['UNKNOWN', 'VERIFYING', () => { const op = unknown(); return [op, claimCommand(op, 'verification')]; }],
  ['UNKNOWN', 'EXECUTING', () => { const op = schedule(unknown({ policySnapshot: replayPolicy }), 'execution'); return [op, claimCommand(op), { now: op.schedule.at }]; }],
  ['VERIFYING', 'ACCEPTED', () => { const op = verifying(); return [op, resultCommand(op, { kind: 'FINAL_NOT_APPLIED', retryable: true })]; }],
  ['VERIFYING', 'UNKNOWN', () => { const op = verifying(); return [op, resultCommand(op, { kind: 'INCONCLUSIVE' })]; }],
  ['VERIFYING', 'COMPLETED', () => { const op = verifying(); return [op, resultCommand(op)]; }],
  ['VERIFYING', 'FAILED', () => { const op = verifying(); return [op, resultCommand(op, { kind: 'CONFIRMED_REJECTED' })]; }],
];
for (const from of OPERATION_STATUSES) for (const to of OPERATION_STATUSES) {
  const route = routes.find(([a, b]) => a === from && b === to);
  test(`transition matrix ${from} -> ${to}: ${route ? 'allowed with evidence' : 'prohibited'}`, () => {
    assert.equal(ALLOWED_TRANSITIONS[from].includes(to), Boolean(route));
    if (route) {
      const [op, command, options] = route[2]();
      const before = JSON.stringify(op);
      const change = transition(op, command, context(op, options));
      assert.equal(change.operation.status, to);
      assert.equal(change.operation.revision, op.revision + 1);
      assert.equal(change.expectedRevision, op.revision);
      assert.equal(change.event.from, from);
      assert.equal(change.event.to, to);
      assert.equal(change.event.revision, change.operation.revision);
      assert.equal(change.event.mutationId, change.mutationId);
      assert.equal(JSON.stringify(op), before);
      assertOperationInvariants(change.operation);
    }
  });
}

test('invalid commands in each state fail explicitly, including arbitrary status mutation', () => {
  const active = claim();
  const verify = verifying();
  const states = [accepted(), active, unknown(), verify, apply(active, resultCommand(active)), apply(active, resultCommand(active, { kind: 'CONFIRMED_REJECTED' }))];
  for (const op of states) {
    errorCode(() => apply(op, { kind: 'SET_STATUS', status: 'COMPLETED' }), 'InvalidOperationTransition');
    if (!['EXECUTING', 'VERIFYING'].includes(op.status)) {
      errorCode(() => apply(op, resultCommand(active)), 'InvalidOperationTransition');
      errorCode(() => apply(op, { kind: 'RECOVER_EXPIRED', jitterSample: 1 }), 'InvalidOperationTransition');
    }
    if (['EXECUTING', 'VERIFYING'].includes(op.status)) {
      errorCode(() => apply(op, claimCommand(op)), 'InvalidOperationTransition');
      errorCode(() => apply(op, { kind: 'SCHEDULE', schedule: null, holdReason: null, jitterSample: 1 }), 'InvalidOperationTransition');
    }
  }
});

test('every command rejects terminal operations, including scheduling, renewal and recovery', () => {
  const active = claim();
  const terminals = [apply(active, resultCommand(active)), apply(active, resultCommand(active, { kind: 'CONFIRMED_REJECTED' }))];
  const commands = [claimCommand(active), resultCommand(active), { ...resultCommand(active), kind: 'VERIFICATION_RESULT' },
    { kind: 'RECOVER_EXPIRED', jitterSample: 1 }, { kind: 'FAIL_LOCAL', reason: 'LOCAL_REJECTION', code: 'X' },
    { kind: 'RENEW', ownership: owner(active), leaseDurationMs: 1000 },
    { kind: 'SCHEDULE', schedule: null, holdReason: 'CONFIGURATION', jitterSample: 1 }];
  for (const op of terminals) for (const command of commands) errorCode(() => apply(op, command), 'InvalidOperationTransition');
});

test('claim increments reservations and fence before any execution, deterministically', () => {
  const op = accepted();
  const command = claimCommand(op);
  const first = transition(op, command, context(op));
  assert.deepEqual(transition(op, command, context(op)), first);
  assert.equal(first.operation.executionCount, 1);
  assert.equal(first.operation.verificationCount, 0);
  assert.equal(first.operation.firstExecutionAt, 1020);
  assert.equal(first.operation.fence, 1);
  assert.equal(first.operation.lease.fence, 1);
  assert.equal(first.operation.activeAttempt.deadlineAt, 1120);
});

test('claim checks due time, holds, matching scope/version, credentials and verifier', () => {
  const op = accepted();
  const command = claimCommand(op);
  errorCode(() => apply(op, command, { now: 999 }), 'NotEligible');
  for (const patch of [{ credentialsReady: false }, { definitionReady: false }, { definitionVersion: 'other' }]) errorCode(() => apply(op, { ...command, readiness: { ...command.readiness, ...patch } }), 'NotEligible');
  errorCode(() => apply(op, { ...command, readiness: { ...command.readiness, principalScope: 'other' } }), 'ScopeMismatch');
  const held = apply(op, { kind: 'SCHEDULE', schedule: null, holdReason: 'CREDENTIALS', jitterSample: 1 });
  errorCode(() => apply(held, claimCommand(held)), 'NotEligible');
  const uncertain = unknown();
  const verify = claimCommand(uncertain, 'verification');
  errorCode(() => apply(uncertain, { ...verify, readiness: { ...verify.readiness, verifierAvailable: false } }), 'NotEligible');
});

test('every mutation checks CAS and scope; storage still must enforce these atomically', () => {
  const op = claim();
  errorCode(() => apply(op, resultCommand(op), { expectedRevision: 0 }), 'RevisionConflict');
  errorCode(() => apply(op, resultCommand(op), { principalScope: 'account-2' }), 'ScopeMismatch');
  errorCode(() => apply(op, resultCommand(op), { targetScope: 'staging' }), 'ScopeMismatch');
});

test('results require current owner, fence, attempt and unexpired lease', () => {
  const op = claim();
  for (const patch of [{ ownerId: 'worker-B' }, { fence: 99 }]) errorCode(() => apply(op, resultCommand(op, {}, { ownership: { ...owner(op), ...patch } })), 'LeaseLost');
  errorCode(() => apply(op, resultCommand(op, {}, { ownership: { ...owner(op), attemptId: 'old' } })), 'StaleAttempt');
  errorCode(() => apply(op, resultCommand(op), { now: op.lease.expiresAt }), 'LeaseLost');
  errorCode(() => apply(op, { kind: 'RENEW', ownership: owner(op), leaseDurationMs: 1000 }, { now: op.lease.expiresAt }), 'LeaseLost');
});

for (const fixture of [claim, verifying]) test(`lease recovery for ${fixture().status} preserves uncertainty and fences out old workers`, () => {
  const op = fixture();
  errorCode(() => apply(op, { kind: 'RECOVER_EXPIRED', jitterSample: 1 }, { now: op.lease.expiresAt - 1 }), 'NotEligible');
  const recovered = apply(op, { kind: 'RECOVER_EXPIRED', jitterSample: 1 }, { now: op.lease.expiresAt });
  assert.equal(recovered.status, 'UNKNOWN');
  assert.equal(recovered.unresolvedEffect, true);
  assert.equal(recovered.fence, op.fence + 1);
  assert.equal(recovered.lease, null);
  assert.equal(recovered.executionCount, op.executionCount);
  assert.equal(recovered.verificationCount, op.verificationCount);
  const replacement = claim(recovered, 'verification');
  assert.ok(replacement.fence > recovered.fence);
  errorCode(() => apply(replacement, resultCommand(replacement, {}, { ownership: owner(op) })), 'LeaseLost');
});

test('renewal changes revision but never emits a fake transition event', () => {
  const op = claim();
  const change = transition(op, { kind: 'RENEW', ownership: owner(op), leaseDurationMs: 1000 }, context(op));
  assert.equal(change.event, null);
  assert.equal(change.operation.revision, op.revision + 1);
  assert.equal(change.operation.fence, op.fence);
  assert.equal(change.operation.activeAttempt, op.activeAttempt);
  errorCode(() => apply(change.operation, resultCommand(change.operation), { expectedRevision: op.revision }), 'RevisionConflict');
});

test('completion and global resolution reject uncorrelated or local evidence', () => {
  const op = claim();
  for (const patch of [{ operationId: 'other' }, { attemptId: 'other' }, { source: 'LOCAL' }, { scope: 'ATTEMPT' }]) errorCode(() => apply(op, resultCommand(op, { evidence: evidence(op, patch) })), 'InvalidEvidence');
  const verify = verifying();
  errorCode(() => apply(verify, resultCommand(verify, { kind: 'FINAL_NOT_APPLIED', retryable: true, evidence: evidence(verify, { scope: 'ATTEMPT' }) })), 'InvalidEvidence');
  errorCode(() => apply(op, resultCommand(op, { kind: 'FINAL_NOT_APPLIED', retryable: true })), 'InvalidEvidence');
  errorCode(() => apply(verify, resultCommand(verify, { kind: 'AMBIGUOUS' })), 'InvalidEvidence');
});

test('inconclusive verification, including not-found and pending, never authorizes execution', () => {
  for (const kind of ['PENDING', 'INCONCLUSIVE']) {
    const op = verifying();
    const result = apply(op, resultCommand(op, { kind, evidence: evidence(op, { code: 'NOT_FOUND' }) }));
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.unresolvedEffect, true);
    const attempt = schedule(result, 'execution');
    errorCode(() => apply(attempt, claimCommand(attempt), { now: attempt.schedule.at }), 'UnsafeReplay');
  }
});

test('safe retry preserves intent, counters and first execution timestamp', () => {
  const first = claim();
  const ready = apply(first, resultCommand(first, noEffect(first)));
  assert.equal(ready.schedule.at, ready.updatedAt + 10);
  const second = claim(ready);
  assert.equal(second.executionCount, 2);
  assert.equal(second.id, first.id);
  assert.equal(second.payload, first.payload);
  assert.equal(second.policySnapshot, first.policySnapshot);
  assert.equal(second.firstExecutionAt, first.firstExecutionAt);
  assert.notEqual(second.activeAttempt.id, first.activeAttempt.id);
  assert.ok(second.fence > first.fence);
});

test('exhaustion can fail known no-effect work, but never UNKNOWN', () => {
  const one = { ...policy, execution: { ...policy.execution, maxAttempts: 1 } };
  const op = claim(accepted({ policySnapshot: one }));
  const failure = apply(op, resultCommand(op, noEffect(op)));
  assert.equal(failure.status, 'FAILED');
  assert.equal(failure.failure.kind, 'BUDGET_EXHAUSTED');
  const uncertain = apply(op, resultCommand(op, { kind: 'AMBIGUOUS' }));
  errorCode(() => apply(uncertain, { kind: 'FAIL_LOCAL', reason: 'BUDGET_EXHAUSTED', code: 'LIMIT' }), 'InvalidOperationTransition');
  const verify = claim(uncertain, 'verification');
  const absent = apply(verify, resultCommand(verify, { kind: 'FINAL_NOT_APPLIED', retryable: true }));
  assert.equal(absent.status, 'FAILED');
  assert.equal(absent.failure.kind, 'BUDGET_EXHAUSTED');
});

test('verification budget exhaustion keeps durable UNKNOWN without a scheduled action', () => {
  const one = { ...policy, verification: { ...policy.verification, maxAttempts: 1 } };
  const op = verifying({ policySnapshot: one });
  const uncertain = apply(op, resultCommand(op, { kind: 'INCONCLUSIVE' }));
  assert.equal(uncertain.status, 'UNKNOWN');
  assert.equal(uncertain.schedule, null);
  errorCode(() => schedule(uncertain, 'verification'), 'BudgetExhausted');
});

test('replay retains earlier uncertainty after no-effect or attempt-only rejection', () => {
  for (const kind of ['NOT_APPLIED', 'CONFIRMED_REJECTED']) {
    const uncertain = schedule(unknown({ policySnapshot: replayPolicy }), 'execution');
    const replay = apply(uncertain, claimCommand(uncertain), { now: uncertain.schedule.at });
    assert.equal(replay.unresolvedEffect, true);
    const result = apply(replay, resultCommand(replay, { kind, retryable: false, evidence: evidence(replay, { scope: 'ATTEMPT' }) }));
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.unresolvedEffect, true);
  }
});

test('global backend evidence resolves replay uncertainty', () => {
  for (const kind of ['CONFIRMED_COMPLETED', 'CONFIRMED_REJECTED']) {
    const uncertain = schedule(unknown({ policySnapshot: replayPolicy }), 'execution');
    const replay = apply(uncertain, claimCommand(uncertain), { now: uncertain.schedule.at });
    const result = apply(replay, resultCommand(replay, { kind }));
    assert.equal(result.status, kind === 'CONFIRMED_COMPLETED' ? 'COMPLETED' : 'FAILED');
    assert.equal(result.unresolvedEffect, false);
  }
});

test('manual scheduling cannot bypass persisted backoff or attempt budget', () => {
  const op = claim();
  const ready = apply(op, resultCommand(op, noEffect(op), { retryAfterAt: 10000 }));
  errorCode(() => schedule(ready, 'execution', 2000), 'NotEligible');
  errorCode(() => apply(ready, claimCommand(ready), { now: 9999 }), 'NotEligible');
  assert.equal(apply(ready, claimCommand(ready), { now: 10000 }).status, 'EXECUTING');
});

test('clock jumps do not become business evidence and do not reorder revisions', () => {
  const op = claim();
  const completed = apply(op, resultCommand(op), { now: 1 });
  assert.equal(completed.status, 'COMPLETED');
  assert.ok(completed.revision > op.revision);
  const recovered = apply(op, { kind: 'RECOVER_EXPIRED', jitterSample: 1 }, { now: 1000000 });
  assert.equal(recovered.status, 'UNKNOWN');
});

test('result snapshot is copied and frozen before proposing terminal persistence', () => {
  const op = claim();
  const command = resultCommand(op);
  const completed = apply(op, command);
  command.result.result.remoteId = 'changed';
  command.result.evidence.code = 'changed';
  assert.equal(completed.completion.result.remoteId, 'payment-1');
  assert.equal(completed.completion.evidence.code, 'CONFIRMED');
  assert.throws(() => { completed.completion.result.remoteId = 'changed'; }, TypeError);
});

test('failure without retry permission and authoritative absence are separate outcomes', () => {
  const op = claim();
  const failure = apply(op, resultCommand(op, { ...noEffect(op), retryable: false }));
  assert.equal(failure.failure.kind, 'NOT_RETRYABLE');
  const verify = verifying();
  const absent = apply(verify, resultCommand(verify, { kind: 'FINAL_NOT_APPLIED', retryable: false }));
  assert.equal(absent.failure.kind, 'NOT_RETRYABLE');
});

test('a hold cannot erase Retry-After and then reschedule before it', () => {
  const op = claim();
  const ready = apply(op, resultCommand(op, noEffect(op), { retryAfterAt: 10000 }));
  const held = apply(ready, { kind: 'SCHEDULE', schedule: null, holdReason: 'CREDENTIALS', jitterSample: 1 });
  assert.equal(held.schedule.at, 10000);
  errorCode(() => schedule(held, 'execution', 2000), 'NotEligible');
  const resumed = schedule(held, 'execution', 10000);
  errorCode(() => apply(resumed, claimCommand(resumed), { now: 9999 }), 'NotEligible');
  assert.equal(apply(resumed, claimCommand(resumed), { now: 10000 }).status, 'EXECUTING');
});

test('malformed no-effect evidence cannot silently become terminal failure', () => {
  const op = claim();
  const result = noEffect(op);
  delete result.retryable;
  errorCode(() => apply(op, resultCommand(op, result)), 'InvalidEvidence');
});

test('pending verification respects Retry-After without interpreting it as evidence', () => {
  const op = verifying();
  const uncertain = apply(op, resultCommand(op, { kind: 'PENDING' }, { retryAfterAt: 10000 }));
  assert.equal(uncertain.status, 'UNKNOWN');
  assert.equal(uncertain.schedule.kind, 'verification');
  assert.equal(uncertain.schedule.at, 10000);
  errorCode(() => apply(uncertain, claimCommand(uncertain, 'verification'), { now: 9999 }), 'NotEligible');
});
