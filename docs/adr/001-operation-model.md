# ADR-001: Model Business Actions as Durable Operations

> Antecedente histórico. Su contenido no es normativo; consultar [ADR-009](009-minimal-operation-state-machine.md) y [ARCHITECTURE.md](../../ARCHITECTURE.md).


- **Status:** Superseded by [ADR-009](009-minimal-operation-state-machine.md) on 2026-09-15
- **Date:** 2026-09-15
- **Decision owners:** MOR
- **Scope:** Core SDK

## Context

The SDK exists to make critical mobile operations reliable when applications operate under unreliable network conditions, process termination, application restarts, timeouts, and transient backend failures.

Traditional HTTP clients model work primarily as requests:

```text
POST /orders
POST /payments
PATCH /inventory/123
```

This representation is insufficient because a network request is only one attempt to execute a business action. An order creation can survive multiple HTTP attempts, application restarts, network changes, verification attempts, and retries while remaining the same logical business operation.

## Decision

The primary domain abstraction SHALL be an `Operation`.

An Operation represents a durable business intent, for example:

```text
order.create
payment.create
inventory.update
inspection.submit
receipt.upload
```

Conceptually:

```ts
interface Operation<TPayload = unknown> {
  id: OperationId
  type: string
  payload: TPayload
  status: OperationStatus
  idempotencyKey?: string
  attempts: number
  maxAttempts: number
  dependencies: OperationId[]
  createdAt: number
  updatedAt: number
  nextAttemptAt?: number
  metadata?: Record<string, unknown>
}
```

The exact TypeScript representation MAY evolve without changing this architectural decision.

## Operation vs Attempt

```text
Operation
   ├── Attempt #1 → timeout
   ├── Attempt #2 → network error
   └── Attempt #3 → success
```

There is one Operation and three execution attempts. Attempt identity MUST NOT replace Operation identity.

## Operation vs HTTP Request

The Core SHALL NOT model an Operation as an HTTP request. The preferred semantic model is:

```ts
client.execute("order.create", payload)
```

Transport adapters MAY translate an Operation into HTTP, GraphQL, RPC, or another protocol.

## Identity

Every Operation SHALL have a globally unique identifier generated before persistence. Identity SHALL remain stable throughout retries, network reconnections, process restarts, verification, dependency resolution, and transport attempts.

## Payload

The payload represents the information necessary to eventually execute the business intent. Payloads MUST be serializable by the configured persistence adapter.

## Metadata

Metadata MAY contain non-domain execution context. Security-sensitive information such as access tokens SHOULD NOT be persisted inside Operation payloads or metadata.

## Invariants

1. An Operation has exactly one stable `OperationId`.
2. An Operation has exactly one current lifecycle state.
3. Transport attempts never create a new Operation unless explicitly requested.
4. Retrying does not change Operation identity.
5. Application restart does not change Operation identity.
6. Terminal Operations cannot return to executable states.
7. State transitions MUST occur through the state machine defined by ADR-003.

## Consequences

### Positive

- Business intent is separated from network mechanics.
- Retry and recovery become domain concepts.
- Operations can survive process death.
- Transport technology can change independently.
- Observability can follow one Operation across many attempts.

### Negative

The SDK becomes more sophisticated than a request queue, and developers must understand the distinction between an Operation and an HTTP request.

## Rejected Alternatives

### Persist raw HTTP requests
Rejected because HTTP is a transport concern.

### Store callbacks/functions
Rejected because functions cannot be reliably serialized and restored.

### Treat every retry as a new Operation
Rejected because it destroys durable identity, observability, and idempotency semantics.

## Result

> A durable Operation represents business intent; network requests are merely attempts to complete it.
