---
sidebar_position: 3
---

# Backend contract

The server must make retries safe. For each Operation type, define an
idempotency key and an authoritative lookup endpoint.

```text
POST /orders
Idempotency-Key: <operation id>

GET /orders/by-operation/<operation id>
```

The create response and the lookup response must identify the same business
operation. A generic HTTP status-code table is insufficient: the application
transport maps each backend response into semantic evidence.

```ts
const orderTransport = {
  async execute(context) {
    const response = await fetch('/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': context.operation.id },
      body: JSON.stringify(context.operation.payload),
    });
    if (response.status === 201) {
      return { result: completedFromCreateResponse(context, await response.json()) };
    }
    if (response.status === 503) {
      return { result: notAppliedRetryable(context) };
    }
    throw new Error(`Unexpected order response: ${response.status}`);
  },
  async verify(context) {
    const response = await fetch(`/orders/by-operation/${context.operation.id}`);
    if (response.status === 200) return { result: completedFromLookup(context, await response.json()) };
    throw new Error('Lookup is inconclusive');
  },
};
```

Timeouts, disconnects and malformed responses are ambiguous. They must lead to
`UNKNOWN` and verification unless server evidence proves the business effect
did not occur and cannot still occur.
