# Integrate FlorexTech Mobile Operation Reliability

This guide shows how an application turns a business intent into a durable
Operation. The SDK is a reliability layer for existing APIs; it is not an HTTP
queue and it does not synchronize a local database with a server.

## 1. Define the backend contract first

For every operation type, agree on an idempotency key and an authoritative
lookup endpoint. A useful order contract is:

```text
POST /orders
Idempotency-Key: <operation id>

GET /orders/by-operation/<operation id>
```

The create response and lookup response must identify the same business
operation. See [BACKEND_IDEMPOTENCY.md](BACKEND_IDEMPOTENCY.md) for the
required semantics before writing the client adapter.

## 2. Open storage and compose the engine

The application owns storage initialization, identity generation, credentials,
the REST mapping and scheduler wake-ups. The Core owns transitions and never
imports Expo, React Native, fetch or a database driver.

```ts
import { OperationEngine, OperationScheduler, operationId } from '@florextech/core';
import { AsyncSQLiteOperationStore } from '@florextech/storage-expo';

const scope = { principalScope: account.id, targetScope: 'production' };
const limits = { maxBytes: 65_536, maxDepth: 32 };
const store = new AsyncSQLiteOperationStore(database, { wallNow: Date.now }, limits);

const opened = await store.open(1);
if (opened.kind === 'ERROR') throw new Error(opened.error.code);

const engine = new OperationEngine({
  storage: store,
  transport: orderTransport,
  clock: { wallNow: Date.now },
  limits,
  leaseDurationMs: 30_000,
  identifiers,
  isDefinitionReady: () => true,
  areCredentialsReady: () => session.accountId === account.id,
  isVerifierAvailable: () => true,
  nextJitterSample: () => Math.random(),
  network,
});
const scheduler = new OperationScheduler(engine, scope, wakePort, network);
```

`identifiers.ownerId`, mutation IDs and attempt IDs must be unique for the
running instance. Keep the scheduler scoped to one account and backend target.
When the signed-in account changes, do not run another account's Operations
under the new credentials.

## 3. Map REST into semantic evidence

`TransportPort` is where the application decides what its backend responses
mean. Do not classify HTTP status codes generically.

```ts
const orderTransport = {
  async execute(context) {
    const response = await fetch('/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': context.operation.id },
      body: JSON.stringify(context.operation.payload),
    });
    if (response.status === 201) {
      return { result: {
        kind: 'CONFIRMED_COMPLETED',
        evidence: operationEvidence(context, 'ORDER_CREATED'),
        result: await response.json(),
      } };
    }
    if (response.status === 503) {
      return { result: {
        kind: 'NOT_APPLIED', retryable: true,
        evidence: attemptEvidence(context, 'ORDER_SERVICE_UNAVAILABLE'),
      } };
    }
    throw new Error(`Unexpected order response: ${response.status}`);
  },
  async verify(context) {
    const response = await fetch(`/orders/by-operation/${context.operation.id}`);
    if (response.status === 200) return { result: completedFromLookup(context, await response.json()) };
    throw new Error(`Inconclusive order lookup: ${response.status}`);
  },
};
```

An exception, timeout, disconnect or unexpected body is ambiguous. Let it
become `UNKNOWN`; do not return `FAILED` unless backend evidence proves the
business effect did not occur and cannot still occur.

## 4. Accept the business intent

Use one ID for the user intent. If a submit acknowledgement is interrupted,
repeat the same intent with the same ID or query it; never create a replacement
ID automatically.

```ts
const id = operationId(createStableOrderOperationId());
const handle = await engine.execute({
  id,
  type: 'order.create',
  definitionVersion: '1',
  principalScope: scope.principalScope,
  targetScope: scope.targetScope,
  idempotencyKey: id,
  payload: { cartId, items, total, currency: 'COP' },
  policySnapshot: {
    execution: { maxAttempts: 3, timeoutMs: 10_000, baseDelayMs: 1_000, maxDelayMs: 30_000 },
    verification: { maxAttempts: 3, timeoutMs: 10_000, baseDelayMs: 1_000, maxDelayMs: 30_000 },
    replay: { kind: 'NONE' },
  },
});

await saveOrderOperationId(cartId, handle.id);
await scheduler.run();
```

`engine.execute` returns only after the Operation is durably accepted or found
as the same existing Operation. It does **not** mean the order has reached the
backend. Persist the handle ID in product state so the UI can reconstruct its
status after a restart.

## 5. Render honest product states

| SDK state | Product copy | Required behavior |
| --- | --- | --- |
| `ACCEPTED`, `EXECUTING`, `VERIFYING` | “Processing your order” | Keep the original intent; wake the scheduler when appropriate. |
| `COMPLETED` | “Order confirmed” | Show the backend-confirmed business result. |
| `FAILED` | “Order could not be placed” | The evidence proved a terminal failure. A correction is a new intent with a new ID. |
| `UNKNOWN` | “We are checking your order” | Keep the same order visible. Do not create another order or claim it failed. |

`handle.confirmed()` resolves only for `COMPLETED`, rejects for `FAILED`, and
may wait indefinitely for `UNKNOWN`. Product code should use storage reads for
recoverable UI rather than treating a local wait timeout as a business result.

## 6. Wake, recover and test

Call `scheduler.run()` after startup, foregrounding and an online network hint.
Those signals only prompt a durable reread; they do not prove remote success.
Test at least a normal completion, a retryable no-effect response, a response
lost after backend apply, and a restart before verification. The
`examples/expo-storefront` reference app and `examples/reliability-fixture`
show one complete local flow.

Read [RELIABILITY.md](../RELIABILITY.md) before choosing a long-lived storage
deployment. The alpha intentionally has no automatic record deletion.
