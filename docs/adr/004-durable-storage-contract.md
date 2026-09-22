# ADR-004: Make Durable Persistence a Mandatory Core Capability

> Antecedente histórico. Su contenido no es normativo; consultar [ADR-010](010-durable-acceptance-and-fenced-storage.md) y [ARCHITECTURE.md](../../ARCHITECTURE.md).


- **Status:** Superseded by [ADR-010](010-durable-acceptance-and-fenced-storage.md) on 2026-09-15
- **Date:** 2026-09-15
- **Decision owners:** MOR

## Context

The SDK promises that accepted Operations survive application restart, JavaScript runtime restart, process termination, and temporary network loss. An in-memory queue cannot provide this guarantee.

## Decision

Every production runtime SHALL provide an implementation of `OperationStore`. The Core SHALL depend on the storage contract rather than SQLite directly.

Conceptually:

```ts
interface OperationStore {
  insert(operation: Operation): Promise<void>
  findById(id: OperationId): Promise<Operation | null>
  findEligible(query: EligibilityQuery): Promise<Operation[]>
  transition(
    id: OperationId,
    transition: OperationTransition
  ): Promise<Operation>
  appendEvent(event: OperationEvent): Promise<void>
  claim(...args: unknown[]): Promise<ClaimResult>
  release(...args: unknown[]): Promise<void>
}
```

Exact signatures MAY evolve.

## Initial Production Adapter

React Native/Expo SHALL initially use SQLite.

```text
Core
 │
 ▼
OperationStore
 ▲
 │
SQLiteOperationStore
```

## Transaction Requirements

Critical lifecycle changes MUST be atomic.

### Acceptance

Operation insertion and initial lifecycle events must commit together.

### State Transition

Status update and event append SHOULD be atomic.

### Claim

Worker claim MUST be atomic.

## Source of Truth

Durable storage SHALL be authoritative. In-memory caches MAY improve performance but MUST be reconstructable.

## Serialization and Migrations

Persisted Operations MUST be versionable. Schema evolution MUST use explicit migrations.

## Sensitive Data

Access tokens, refresh tokens, and transient credentials SHOULD NOT be persisted as Operation payload data.

## Storage Errors

Storage errors MUST NOT be converted into successful acceptance.

## Rejected Alternatives

### AsyncStorage as primary store
Rejected because transactional semantics, querying, indexing, and atomic claims are required.

### Memory queue
Rejected because it cannot survive process death.

## Result

> If an Operation cannot be durably committed, the SDK does not own it.
