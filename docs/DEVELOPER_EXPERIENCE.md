# Developer experience guide

## Composition

The application owns identity generation, credentials, operation definitions and transport mapping. The SDK owns durable state transitions. Keep the composition root explicit: open storage, construct the engine, construct a scheduler per scope, and close storage only after stopping new work.

## Error handling

`execute()` throws `OperationAcceptanceError` when durable admission did not commit. Do not call the backend yourself after that error. `handle.confirmed()` resolves only for `COMPLETED` and rejects with `OperationTerminalError` for `FAILED`. `UNKNOWN` is intentionally non-terminal: schedule verification or satisfy the replay contract.

## Testing

Use `FakeTransport` for ordinary deterministic tests and `ChaosTransport` for scripted response loss or transient faults. Assert durable status and event history, rather than counting HTTP calls alone.

## Inspector

`@florextech/inspector` is read-only. Supply an `InspectorRepository` from an adapter that can inventory terminal records. Its default payload view redacts token-like fields before UI rendering.
