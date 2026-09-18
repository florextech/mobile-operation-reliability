# FlorexTech Mobile Operation Reliability

TypeScript SDK for durable business operations in mobile clients. It accepts an operation to durable storage before a remote attempt, and distinguishes a backend-confirmed outcome from an uncertain one.

## Quick start

1. Choose a `StoragePort` adapter and open it before accepting work.
2. Compose `OperationEngine` with an application-specific `TransportPort`.
3. Call `execute` with a business operation. The returned handle means the operation is durable, not that the backend has completed it.
4. Run the scheduler when the application is able to make requests. Await `handle.confirmed()` only when the product needs a terminal backend outcome.

```ts
const handle = await engine.execute({
  id: crypto.randomUUID(), type: 'order.create', definitionVersion: '1',
  principalScope: accountId, targetScope: environment, idempotencyKey: orderId,
  payload: { orderId }, policySnapshot,
});

await scheduler.run();
const completed = await handle.confirmed();
```

`ACCEPTED` certifies local durability. `COMPLETED` requires backend evidence. A timeout or lost response becomes `UNKNOWN` and must be verified or replayed only under the registered safety contract.

Read the [public API](docs/PUBLIC_API.md), [developer integration guide](docs/DEVELOPER_EXPERIENCE.md), [backend idempotency contract](docs/BACKEND_IDEMPOTENCY.md), and [reliability limits](RELIABILITY.md) before integrating the SDK.
