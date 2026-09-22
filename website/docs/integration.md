---
sidebar_position: 2
---

# Integrate the SDK

The application owns storage initialization, identities, authentication, REST
mapping and scheduler wake-ups. The Core owns the Operation state machine and
does not import React Native, Expo, a database driver or a network client.

```ts
import { OperationEngine, OperationScheduler, operationId } from '@florexlabs/mor';
import { AsyncSQLiteOperationStore } from '@florexlabs/mor-expo';

const scope = { principalScope: account.id, targetScope: 'production' };
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

## Submit one durable business intent

Use a stable ID for one user intent. If acknowledgement is interrupted, repeat
the same ID or query its state; do not silently create a replacement intent.

```ts
const handle = await engine.execute({
  id: operationId(createStableOrderOperationId()),
  type: 'order.create',
  definitionVersion: '1',
  principalScope: scope.principalScope,
  targetScope: scope.targetScope,
  idempotencyKey: orderId,
  payload: { orderId },
  policySnapshot,
});

await scheduler.run();
```

The returned handle means the SDK durably owns the intent. It does not mean
the backend completed it. Persist the handle ID in product state so the UI can
reconstruct its status after a restart.

## Render the business state

| State | Product behavior |
| --- | --- |
| `ACCEPTED`, `EXECUTING`, `VERIFYING` | Keep the original intent and show that it is processing. |
| `COMPLETED` | Render the backend-confirmed result. |
| `FAILED` | Show a terminal failure. A correction is a new intent. |
| `UNKNOWN` | Keep the original intent visible while verification continues. Never create a duplicate automatically. |

Call `scheduler.run()` at startup, foregrounding and when network availability
changes. These are wake-up hints only; they never establish remote success.
