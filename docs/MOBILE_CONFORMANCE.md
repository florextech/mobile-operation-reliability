# Mobile conformance matrix

This matrix records what the Expo examples prove. It is an
evidence log, not a product-support claim. The Core guarantees only follow from
a successful durable adapter commit and backend evidence; a mobile signal never
changes an Operation by itself.

## Environment exercised

- Expo SDK 57, React Native 0.86.3 and `expo-sqlite` 57.
- iOS Simulator: iPhone 17 Pro Max, iOS 26.4.
- Local idempotent fixture using the payment contract in
  `examples/reliability-fixture`.
- Storefront reference app: `examples/expo-storefront`, using its
  `order.create` contract.

## Results

| Scenario | Procedure | Result | Evidence |
| --- | --- | --- | --- |
| Durable acceptance | Create a payment while the fixture is available. | PASS | The screen showed `ACCEPTED` before the scheduler call, then `COMPLETED`; the record is in Expo SQLite. |
| Response loss | Select **Inject response loss then accept**. | PASS | The fixture applied exactly one payment then dropped the response; the local Operation became `UNKNOWN`. |
| Kill and restart verification | Force-close Expo Go after response loss, reopen the lab, select **Run recovery / verification**. | PASS | The persisted Operation was rehydrated and reached `COMPLETED` through `GET /payments/:id`, with no second payment. |
| Retryable HTTP outcome | Select **Inject 429 then accept** or **Inject 503 then accept**. | AUTOMATED | Fixture contract tests prove 429/503; `LabTransport` maps them to retryable `NOT_APPLIED` results and preserves `Retry-After` for 429. |
| Network and foreground wake-up | Toggle network or return the app to foreground with due work. | IMPLEMENTED, DEVICE RUN PENDING | `ExpoNetworkHint` and `connectLifecycle` only wake `OperationScheduler`; a physical-device run remains required. |
| Two runtimes on one database | Start two application runtimes sharing one database. | PENDING | Requires a supported deployment configuration; Node SQLite has a six-process claim race regression. |
| Disk full and database corruption | Inject a storage failure on an Expo device. | PENDING | Node SQLite has `SQLITE_FULL`, corruption, migration and kill regressions. Expo must be run on a controlled device before support can be claimed. |

## Storefront run — 2026-09-18

| Scenario | Procedure | Result | Evidence |
| --- | --- | --- | --- |
| Normal order | Bind the fixture to the Mac LAN interface, configure `EXPO_PUBLIC_FIXTURE_URL`, and place a pickup order on iOS Simulator. | PASS | `order-1789772236548` reached `COMPLETED` and was rendered as **Confirmed**. |
| Applied order with lost response | Put the fixture in `drop-after-apply` mode and place a pickup order. | PASS | The fixture's idempotent order lookup resolved the applied order without requiring a replay. |
| Crash during response loss | Put the fixture in `drop-after-apply-delayed` mode, place a pickup order, terminate Expo Go while the call is in flight, then reopen the app. | PASS | `order-1789772316686` was recovered from Expo SQLite and reached **Confirmed** through `GET /orders/:idempotencyKey`. The backend returned the single effect `{ "id": "order-1", "operationId": "order-1789772316686" }`. |
| Android conformance | Run the same scenarios on an Android emulator or physical device. | PENDING | No Android device or emulator was attached to this validation environment. |

## Reproduce the response-loss run

1. Start the fixture: `pnpm --filter @florextech/reliability-fixture start`.
2. Start the lab with a fixture URL reachable from the simulator or device:
   `EXPO_PUBLIC_FIXTURE_URL=http://HOST:3000 pnpm --filter @florextech/expo-reliability-lab start`.
3. Open the lab, choose **Inject response loss then accept**, then force-close
   and reopen it.
4. Choose **Run recovery / verification**. The same Operation ID must become
   `COMPLETED`; querying `GET /payments/:operationId` must show one effect.

The administrative fixture controls exist only in the local test server. They
are not SDK APIs and must never be copied into a production backend.
