# ADR-006: Coordinate Concurrent Workers Using Durable Leases

> Antecedente histórico. Su contenido no es normativo; consultar [ADR-010](010-durable-acceptance-and-fenced-storage.md) y [ARCHITECTURE.md](../../ARCHITECTURE.md).


- **Status:** Superseded by [ADR-010](010-durable-acceptance-and-fenced-storage.md) on 2026-09-15
- **Date:** 2026-09-15
- **Decision owners:** MOR

## Context

Foreground execution, network reconnect, application foreground, background workers, and manual retry can all attempt to process the same Operation.

An in-memory mutex is insufficient because processes can terminate and runtimes can restart.

## Decision

Executable Operations SHALL be claimed using durable leases.

Conceptual persisted fields:

```text
lease_owner
lease_until
```

## Claim Semantics

A worker generates a unique identity and attempts an atomic claim:

```text
OP-123

lease_owner = worker-A
lease_until = T + leaseDuration
```

Only one worker may successfully claim an Operation during a lease period.

## Concurrent Claim

```text
Worker A → claim ✓
Worker B → claim ✗
```

Worker B SHALL NOT execute the Operation.

## Process Death

When a worker dies, its lease eventually expires and the Operation becomes recoverable. Correctness MUST NOT depend on explicit cleanup from the dead worker.

## Lease Renewal

Long-running execution MAY renew a lease. Only the current owner may renew it.

## Atomicity

Claim acquisition MUST be atomic at the storage layer.

## Guarantee Boundary

Durable leases prevent concurrent local workers from intentionally executing the same Operation simultaneously.

They DO NOT provide exactly-once remote execution.

```text
Worker A
  ↓
remote side effect succeeds
  ↓
process dies before local COMPLETED commit
```

The Operation may later be recovered. Idempotency and verification remain necessary.

## Clock

Lease calculations SHALL use `ClockPort`.

## Required Tests

- simultaneous claims;
- lease expiry;
- owner-only renewal;
- process-death recovery;
- terminal Operation rejection;
- high contention;
- stale worker completion attempts.

## Result

> Concurrency is coordinated durably, while duplicate remote side effects are handled separately through idempotency and verification.
