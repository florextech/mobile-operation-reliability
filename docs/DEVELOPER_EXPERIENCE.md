# Developer experience guide

## Composition

The application owns identity generation, credentials, operation definitions and transport mapping. The SDK owns durable state transitions. Keep the composition root explicit: open storage, construct the engine, construct a scheduler per scope, and close storage only after stopping new work.

## Error handling

`execute()` throws `OperationAcceptanceError` when durable admission did not commit. Do not call the backend yourself after that error. `handle.confirmed()` resolves only for `COMPLETED` and rejects with `OperationTerminalError` for `FAILED`. `UNKNOWN` is intentionally non-terminal: schedule verification or satisfy the replay contract.

## Testing

Use `FakeTransport` for ordinary deterministic tests and `ChaosTransport` for scripted response loss or transient faults. Assert durable status and event history, rather than counting HTTP calls alone.

## Inspector

`@florexlabs/mor-inspector` is read-only. Supply an `InspectorRepository` from an adapter that can inventory terminal records. Its default payload view redacts token-like fields before UI rendering.

The `expo-reliability-lab` mounts a development-only panel behind `__DEV__`.
It lists scoped Operations and, after selection, shows the durable status,
attempt budgets, scheduled work, transition timeline and redacted payload. The
panel has no commands that mutate Operations: retry and verification remain the
responsibility of the scheduler and its persisted guards.

## Lifecycle checklist

1. Generate one stable operation ID per user intent and keep it if submit must
   be reconciled.
2. Use stable `principalScope` and `targetScope`; do not execute an account's
   work under another account's credentials.
3. Validate and minimize the JSON payload before `engine.execute`. Never put
   credentials, raw tokens or temporary file paths in it.
4. Persist the returned operation ID in any product record that needs to show
   its status. A receipt from `execute` means `ACCEPTED`, not `COMPLETED`.
5. Wake a scoped scheduler from application lifecycle and network signals, but
   treat those signals only as opportunities to reread storage.
6. Show `UNKNOWN` as an unresolved outcome. Do not create a replacement order
   or payment automatically.

## Backend integration checklist

For each `Operation.type`, map a business request and a verification request in
one `TransportPort`. Document the idempotency-key scope, payload equality,
concurrent duplicate behavior, evidence response, and retention window. A 2xx
status alone is not a completion contract. See
[BACKEND_IDEMPOTENCY.md](BACKEND_IDEMPOTENCY.md).

## Storage and retention

Open and validate the storage adapter before enabling checkout or submit UI.
The alpha has no automatic cleanup and no total database quota; choose
`PayloadLimits` deliberately and handle storage errors as admission failures.
Read [RELIABILITY.md](../RELIABILITY.md) before using the SDK for a long-lived
application.
