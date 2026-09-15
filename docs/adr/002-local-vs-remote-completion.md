# ADR-002: Separate Local Acceptance from Remote Completion

> Antecedente histórico. Su contenido no es normativo; consultar [ADR-010](010-durable-acceptance-and-fenced-storage.md) y [ARCHITECTURE.md](../../ARCHITECTURE.md).


- **Status:** Superseded by [ADR-010](010-durable-acceptance-and-fenced-storage.md) on 2026-09-15
- **Date:** 2026-09-15
- **Decision owners:** FlorexTech

## Context

An offline-capable reliability SDK cannot define success exclusively as receiving a successful response from the remote backend.

Two separate facts exist:

1. The SDK durably owns the Operation.
2. The remote system completed the Operation.

These facts MUST NOT be represented as the same state.

## Decision

The SDK SHALL distinguish `ACCEPTED` from `COMPLETED`.

### ACCEPTED

`ACCEPTED` means the Operation has been successfully committed to durable local storage and the SDK has assumed responsibility for its lifecycle.

It does NOT mean the backend received or processed it.

### COMPLETED

`COMPLETED` means the SDK has sufficient evidence that the remote Operation completed successfully.

## Persistence Boundary

The required ordering is:

```text
create Operation
      ↓
begin transaction
      ↓
persist Operation
      ↓
persist initial events
      ↓
COMMIT
      ↓
ACCEPTED
      ↓
remote execution
```

Network execution MUST NOT precede durable acceptance.

## Public API Semantics

The primary submission API SHOULD resolve once durable acceptance occurs:

```ts
const operation = await client.execute("order.create", payload)
```

At this point:

```text
SDK owns Operation ✓
Backend completed   ?
```

The returned handle SHOULD expose a separate mechanism for remote completion:

```ts
await operation.confirmed()
```

## Failure to Persist

If durable persistence fails, `execute()` MUST reject. The SDK MUST NOT report `ACCEPTED`.

## Invariants

1. `ACCEPTED` requires successful durable persistence.
2. `COMPLETED` requires remote completion evidence.
3. `ACCEPTED` does not imply `COMPLETED`.
4. Connectivity is not required for local acceptance.
5. `execute()` MUST NOT remain pending solely because the device is offline.
6. Storage failures MUST be observable by the caller.

## Rejected Alternative

### Resolve only after backend confirmation
Rejected because it makes offline execution impossible as a first-class behavior and conflates durability with connectivity.

## Result

> ACCEPTED: “I have your Operation.”

> COMPLETED: “The remote system completed your Operation.”
