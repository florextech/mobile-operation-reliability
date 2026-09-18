# Café Flores storefront

`expo-storefront` is a small reference application that shows an ordinary
consumer flow, rather than a reliability test console. A customer selects
coffee and pastry, then places a pickup order.

The checkout button creates an `order.create` Operation. The app persists that
Operation in Expo SQLite before the scheduler may call the REST API. The recent
orders area reads the durable record on startup, so an interrupted checkout can
continue to be represented after the app restarts.

## Run locally

In one terminal, start the idempotent local API fixture:

```sh
pnpm --filter @florextech/reliability-fixture start
```

In another terminal, start the storefront. Use a host reachable from the
simulator or device when it is not `127.0.0.1`:

```sh
EXPO_PUBLIC_FIXTURE_URL=http://HOST:3000 pnpm --filter @florextech/expo-storefront start
```

The fixture accepts `POST /orders` and provides `GET /orders/:idempotencyKey`
for verification. It is local test infrastructure, not a backend SDK or a
production API contract.

## What the customer sees

- A normal cart and pickup checkout flow.
- A confirmation state when the backend has confirmed the order.
- A “checking order” state for `UNKNOWN`; it does not state that an order failed
  merely because the mobile client lost a response.

The operational mechanisms—leases, mutation IDs, retry schedules and backend
evidence—remain inside the integration. This is intentional: a product UI
communicates customer outcomes, while the SDK preserves the durable operation.
