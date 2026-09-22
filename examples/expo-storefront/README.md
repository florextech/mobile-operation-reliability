# Café Flores storefront

This reference app demonstrates `@florexlabs/mor` and
`@florexlabs/mor-expo`. It will consume their published packages after the
first MOR release is available on npm.

`expo-storefront` is a small reference application that shows an ordinary
consumer flow, rather than a reliability test console. A customer selects
coffee and pastry, then places a pickup order.

The checkout button creates an `order.create` Operation. The app persists that
Operation in Expo SQLite before the scheduler may call the REST API. The recent
orders area reads the durable record on startup, so an interrupted checkout can
continue to be represented after the app restarts.

## Run locally

In one terminal, start the idempotent local API fixture. For an iOS simulator or
physical device, bind it to your LAN interface and use your Mac's LAN address:

```sh
HOST=0.0.0.0 pnpm --filter @florexlabs/reliability-fixture start
```

In another terminal, start the storefront. Use a host reachable from the
simulator or device when it is not `127.0.0.1`:

```sh
EXPO_PUBLIC_FIXTURE_URL=http://YOUR_MAC_LAN_IP:3000 pnpm --filter @florexlabs/expo-storefront start
```

The fixture accepts `POST /orders` and provides `GET /orders/:idempotencyKey`
for verification. It is local test infrastructure, not a backend SDK or a
production API contract.

For crash-recovery validation, the fixture also exposes its test-only
`POST /admin/mode` control. `drop-after-apply-delayed` applies an order, waits
five seconds, then drops the response. Terminate and reopen Expo Go during that
window; the app must show the same order as confirmed after verification. This
control belongs only to local test infrastructure.

## What the customer sees

- A normal cart and pickup checkout flow.
- A confirmation state when the backend has confirmed the order.
- A “checking order” state for `UNKNOWN`; it does not state that an order failed
  merely because the mobile client lost a response.

The operational mechanisms—leases, mutation IDs, retry schedules and backend
evidence—remain inside the integration. This is intentional: a product UI
communicates customer outcomes, while the SDK preserves the durable operation.
