# @florextech/core

Portable TypeScript coordination for durable business Operations. The Core owns
state transitions, retry eligibility, leases and uncertain outcomes; adapters
provide storage, transport, clock and network signals.

An Operation is a business intent such as `order.create`, not an HTTP request.
`OperationEngine.execute()` first obtains durable acceptance through a
`StoragePort`. A remote call happens only later when an `OperationScheduler`
claims the accepted record.

```ts
import { OperationEngine, OperationScheduler, operationId } from '@florextech/core';

const handle = await engine.execute({
  id: operationId('stable-order-operation-id'),
  type: 'order.create',
  definitionVersion: '1',
  principalScope: 'account-123',
  targetScope: 'production',
  idempotencyKey: 'stable-order-operation-id',
  payload: { orderId: 'order-123' },
  policySnapshot,
});

await scheduler.run();
```

The handle means the SDK durably owns the intent. It does not mean the backend
completed it. `COMPLETED` requires backend evidence; a timeout or lost response
can become `UNKNOWN` and must not be presented as failure.

The package has no runtime dependency on React Native, Expo, SQLite, fetch,
Axios, NetInfo or platform timers. `@florextech/core/testing` provides
`FakeTransport` and `ChaosTransport` for deterministic consumer tests.

For the full backend contract, integration lifecycle and reliability limits,
read the repository documentation before publishing a transport adapter.
