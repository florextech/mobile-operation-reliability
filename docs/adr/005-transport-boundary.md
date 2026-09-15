# ADR-005: Keep Network Transport Outside the Core Domain

> Antecedente histórico. Su contenido no es normativo; consultar [ADR-011](011-evidence-safe-retry-and-verification.md) y [ARCHITECTURE.md](../../ARCHITECTURE.md).


- **Status:** Superseded by [ADR-011](011-evidence-safe-retry-and-verification.md) on 2026-09-15
- **Date:** 2026-09-15
- **Decision owners:** FlorexTech

## Context

The initial target is existing REST APIs, but tying the engine directly to Fetch, Axios, or HTTP would unnecessarily couple reliability semantics to one transport.

## Decision

The Core SHALL communicate with remote systems through a `TransportPort`.

```ts
interface TransportPort {
  execute(context: ExecutionContext): Promise<TransportResult>
}
```

The Core SHALL NOT depend directly on Fetch, Axios, React Native networking, or GraphQL clients.

## Transport Responsibilities

A transport adapter is responsible for:

- translating an Operation into a remote request;
- executing that request;
- normalizing protocol-specific results;
- exposing sufficient evidence for outcome classification.

## Core Responsibilities

The Core decides:

- lifecycle transitions;
- retry eligibility;
- scheduling;
- uncertain-outcome handling;
- verification orchestration;
- durable state.

## Result Taxonomy

Transport results SHOULD normalize protocol behavior into semantic categories:

```text
CONFIRMED_SUCCESS
CONFIRMED_FAILURE
TRANSIENT_FAILURE
UNCERTAIN_OUTCOME
```

Protocol metadata MAY accompany the result.

## Initial Adapter

The first official adapter SHOULD use standards-based Fetch where runtime support is adequate.

## Authentication

Credentials SHOULD be resolved as close to execution time as possible. Persisting access tokens inside Operations is discouraged.

## Result

> The engine manages reliable Operations; adapters decide how those Operations communicate with remote systems.
