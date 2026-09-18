# Backend idempotency guide

The client cannot infer a business outcome from an HTTP status code. For every operation type, the backend must define a stable idempotency key, its retention window, and a verification endpoint that can return authoritative operation-level evidence.

Persist the key before the request, deduplicate it transactionally on the backend, and return the same business result for duplicates. A verification response must correlate the SDK operation ID and attempt ID where applicable. If the retention window expires, configure replay as unsafe; `UNKNOWN` then remains unresolved until authoritative evidence arrives.

Never treat a timeout, disconnect, 5xx response, or client exception as proof that the backend did not apply a payment, order or inventory change.

## Minimum operation contract

For an operation such as `order.create`, the backend contract must state:

- the idempotency-key scope, usually account plus target environment;
- the canonical payload identity used to reject a conflicting duplicate key;
- atomic persistence of the key and the business effect;
- what concurrent requests for the same key return;
- the retention period for both key and result;
- a lookup that returns **confirmed completed**, **confirmed final absence**, or
  **inconclusive** evidence for that exact operation.

A completion response must correlate to the operation identity. For example,
the fixture returns an `operationId` with the created order. If a backend only
returns a generic `202`, the adapter must classify it as pending or unknown,
not completed.

## Adapter rule

The application-specific `TransportPort` maps this contract into semantic
results. Classify network exceptions and unexpected bodies as ambiguous. Only
return `CONFIRMED_COMPLETED` from evidence that proves the business effect for
the Operation, and only return final absence when a later execution cannot
still arrive. Do not implement hidden HTTP-client retries for mutating calls.
