# ADR-008: Represent Uncertain Remote Outcomes Explicitly and Verify Before Unsafe Retry

> Antecedente histórico. Su contenido no es normativo; consultar [ADR-011](011-evidence-safe-retry-and-verification.md) y [ARCHITECTURE.md](../../ARCHITECTURE.md).


- **Status:** Superseded by [ADR-011](011-evidence-safe-retry-and-verification.md) on 2026-09-15
- **Date:** 2026-09-15
- **Decision owners:** FlorexTech

## Context

A timeout does not necessarily mean a remote Operation failed:

```text
13:00:00 POST /payments
13:00:01 server commits payment ✓
13:00:30 client timeout
```

The client cannot prove either success or failure.

## Decision

The SDK SHALL represent uncertain outcomes explicitly using `UNKNOWN`.

`UNKNOWN` means:

> A remote side effect may have occurred, but the SDK currently lacks sufficient evidence to classify the Operation as completed or failed.

## FAILED vs UNKNOWN

`FAILED` means there is sufficient evidence that the attempted execution did not complete successfully.

`UNKNOWN` means there is insufficient evidence to know whether the side effect occurred.

Therefore:

```text
FAILED ≠ UNKNOWN
```

## Lifecycle

```text
EXECUTING
    ↓
ambiguous outcome
    ↓
UNKNOWN
    ↓
VERIFYING
```

## Verification

Operations MAY define a verification strategy.

```text
payment.create
      ↓
UNKNOWN
      ↓
GET /payments/by-idempotency-key/abc
```

Possible resolutions:

```text
FOUND + confirmed → COMPLETED
PROVEN ABSENT     → QUEUED
STILL UNCERTAIN   → UNKNOWN
```

## Safety Rule

An UNKNOWN Operation MUST NOT be blindly retried when retry could duplicate a non-idempotent side effect.

Retry requires at least one of:

1. remote idempotency guarantees make retry safe;
2. verification proves the previous attempt did not take effect;
3. explicit application policy accepts the risk.

## Verification Durability

Verification state and attempts SHALL survive application restart when they affect correctness.

## Verification Contract

The Core SHALL define a protocol-independent verification contract.

## Unresolvable UNKNOWN

Some Operations may remain UNKNOWN indefinitely. The SDK MUST surface them for application/manual intervention rather than silently converting them to failure.

## Observability

UNKNOWN transitions SHOULD be prominently exposed through telemetry and developer tooling.

## Rejected Alternatives

### Treat timeout as failure
Rejected because it can cause duplicate business side effects.

### Always retry UNKNOWN
Rejected because retry may be unsafe.

### Always require verification
Rejected because not every Operation needs it and some backends cannot provide it.

## Result

> When the SDK does not know what happened remotely, it says so explicitly instead of guessing.
