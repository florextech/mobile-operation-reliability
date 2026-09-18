---
sidebar_position: 1
slug: /
---

# Mobile Operation Reliability

FlorexTech MOR makes a business intent durable before a React Native or Expo
application calls an existing REST API. An `order.create`, `payment.create` or
`inventory.update` is an **Operation**: it is not an HTTP request.

## Guarantees

- `ACCEPTED` means the SDK has durably stored the Operation.
- `COMPLETED` means the backend supplied evidence that the business effect
  occurred.
- `FAILED` means evidence proves a terminal business failure.
- `UNKNOWN` preserves uncertainty when the backend may have applied an effect
  but the client did not receive a conclusive response.

The SDK coordinates durable retry, verification and crash recovery. It does
not synchronize a database, replicate offline data, replace backend
idempotency or guarantee operating-system background execution.

## Start here

1. Define the backend idempotency and lookup contract.
2. Compose the Core with an application-owned storage adapter and transport.
3. Submit a stable Operation ID and render the durable state honestly.

Continue with the [integration guide](./integration).
