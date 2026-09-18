# FlorexTech Mobile Operation Reliability

Reliable business operations for React Native and Expo apps that call existing
REST APIs. Persist an `order.create`, `payment.create` or `inventory.update`
intention before attempting the network, then preserve the difference between a
backend-confirmed result and an uncertain one.

## What it does

1. Stores a business Operation durably before remote execution.
2. Returns `ACCEPTED` only after local storage confirms possession.
3. Coordinates retries, leases, crash recovery and backend verification.
4. Returns `COMPLETED` only when backend evidence confirms the business result.
5. Preserves `UNKNOWN` when the backend may have applied the effect but the
   client lost its response.

## What it does not do

It is not a database synchronization engine, offline data replica, generic HTTP
queue, cross-device coordinator, background-execution guarantee or replacement
for backend idempotency.

## Start integrating

```ts
const handle = await engine.execute({
  id: operationId(createStableOrderOperationId()),
  type: 'order.create', definitionVersion: '1',
  principalScope: accountId, targetScope: 'production',
  idempotencyKey: orderId, payload: { orderId }, policySnapshot,
});

await scheduler.run();
```

`handle` means the SDK durably owns the intent. It does not mean the backend
completed it. Build your REST mapping and product UI around `COMPLETED`,
`FAILED` and `UNKNOWN` using the full [integration guide](docs/INTEGRATION.md).

## Documentation

- [Integration guide](docs/INTEGRATION.md)
- [Backend idempotency contract](docs/BACKEND_IDEMPOTENCY.md)
- [Public alpha API](docs/PUBLIC_API.md)
- [Reliability guarantees and limits](RELIABILITY.md)
- [Mobile conformance matrix](docs/MOBILE_CONFORMANCE.md)
- [Architecture and ADRs](ARCHITECTURE.md)
- [Release workflow](docs/RELEASE.md)
