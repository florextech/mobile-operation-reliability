# Backend idempotency guide

The client cannot infer a business outcome from an HTTP status code. For every operation type, the backend must define a stable idempotency key, its retention window, and a verification endpoint that can return authoritative operation-level evidence.

Persist the key before the request, deduplicate it transactionally on the backend, and return the same business result for duplicates. A verification response must correlate the SDK operation ID and attempt ID where applicable. If the retention window expires, configure replay as unsafe; `UNKNOWN` then remains unresolved until authoritative evidence arrives.

Never treat a timeout, disconnect, 5xx response, or client exception as proof that the backend did not apply a payment, order or inventory change.
