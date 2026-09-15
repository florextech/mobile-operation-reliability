# ADR-007: Treat Idempotency as a First-Class Reliability Mechanism

> Antecedente histórico. Su contenido no es normativo; consultar [ADR-011](011-evidence-safe-retry-and-verification.md) y [ARCHITECTURE.md](../../ARCHITECTURE.md).


- **Status:** Superseded by [ADR-011](011-evidence-safe-retry-and-verification.md) on 2026-09-15
- **Date:** 2026-09-15
- **Decision owners:** FlorexTech

## Context

Reliable retry creates an unavoidable distributed-systems problem:

```text
Client
  │
  │ POST payment
  ▼
Server
  │
  │ payment committed ✓
  ▼
response lost
```

Blind retry may create duplicate side effects.

## Decision

The SDK SHALL support stable idempotency keys as first-class Operation metadata.

An idempotency key MUST remain stable across every retry of the same logical Operation.

```text
Operation OP-123

Attempt 1 → Idempotency-Key: abc
Attempt 2 → Idempotency-Key: abc
Attempt 3 → Idempotency-Key: abc
```

## Generation

Applications MAY provide an idempotency key. The SDK MAY generate one automatically when appropriate.

Generated keys SHOULD derive from stable Operation identity unless a domain-specific key is supplied.

## Backend Cooperation

The SDK cannot independently guarantee idempotent remote side effects.

```text
SDK idempotency support
+
backend enforcement
=
duplicate side-effect protection
```

## HTTP Adapter

HTTP transports MAY map the key to a configurable header such as `Idempotency-Key`.

## Local Deduplication

Local submission deduplication and remote idempotency SHALL remain separate concepts.

## Exactly-Once

The SDK SHALL NOT claim exactly-once execution.

The realistic model is:

```text
at-least-once execution attempts
+
idempotent remote handling
+
verification
```

## Documentation

Backend integration documentation MUST explain server-side idempotency requirements.

## Result

> Retries are expected; duplicate business effects are controlled through stable identity and backend cooperation, not by pretending retries never occur.
