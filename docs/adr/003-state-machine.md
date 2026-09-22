# ADR-003: Centralize Operation Lifecycle in a Deterministic State Machine

> Antecedente histórico. Su contenido no es normativo; consultar [ADR-009](009-minimal-operation-state-machine.md) y [ARCHITECTURE.md](../../ARCHITECTURE.md).


- **Status:** Superseded by [ADR-009](009-minimal-operation-state-machine.md) on 2026-09-15
- **Date:** 2026-09-15
- **Decision owners:** MOR

## Context

Operations can experience retries, offline periods, process death, uncertain outcomes, verification, and dependency blocking. Arbitrary state mutation would make correctness difficult to reason about.

## Decision

Every Operation SHALL be governed by a deterministic state machine. Direct state mutation SHALL NOT be allowed by domain code.

## States

```text
CREATED
ACCEPTED
QUEUED
BLOCKED
EXECUTING
RETRYING
UNKNOWN
VERIFYING
COMPLETED
FAILED_PERMANENTLY
CANCELLED
```

## Terminal States

```text
COMPLETED
FAILED_PERMANENTLY
CANCELLED
```

Terminal states SHALL NOT transition back into active states.

## Main Lifecycle

```text
CREATED
   ↓
ACCEPTED
   ↓
QUEUED
   ↓
EXECUTING
   ├───────────────→ COMPLETED
   ├───────────────→ RETRYING ───→ QUEUED
   └───────────────→ UNKNOWN
                           ↓
                       VERIFYING
                        /      \
                       ↓        ↓
                COMPLETED     QUEUED
```

Dependencies may produce:

```text
ACCEPTED
   ↓
BLOCKED
   ↓
QUEUED
```

## Transition Table

| From | To | Allowed |
|---|---|---|
| CREATED | ACCEPTED | Yes |
| ACCEPTED | QUEUED | Yes |
| ACCEPTED | BLOCKED | Yes |
| QUEUED | EXECUTING | Yes |
| BLOCKED | QUEUED | Yes |
| EXECUTING | COMPLETED | Yes |
| EXECUTING | RETRYING | Yes |
| EXECUTING | UNKNOWN | Yes |
| EXECUTING | FAILED_PERMANENTLY | Yes |
| RETRYING | QUEUED | Yes |
| UNKNOWN | VERIFYING | Yes |
| UNKNOWN | FAILED_PERMANENTLY | Policy dependent |
| VERIFYING | COMPLETED | Yes |
| VERIFYING | QUEUED | Only when retry is proven safe |
| VERIFYING | UNKNOWN | Yes |
| non-terminal | CANCELLED | Policy dependent |
| terminal | active state | No |

Any transition not explicitly permitted SHALL be rejected.

## Transition Persistence

State transition and corresponding event creation SHOULD be atomic:

```text
BEGIN
UPDATE operation status
INSERT operation_event
COMMIT
```

## Invalid Transitions

Invalid transitions SHALL fail explicitly with a domain error such as `InvalidOperationTransition`.

## Recovery

Persisted state is authoritative after restart. In-memory state MUST NOT supersede durable state.

## Testing Requirements

Every allowed transition and prohibited transition category SHALL have tests. Terminal-state immutability SHALL have explicit tests.

## Result

> Operation lifecycle is controlled by one explicit, testable state machine rather than scattered conditionals.
