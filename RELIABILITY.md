# Reliability guarantees

## Demonstrated

- Acceptance is committed before remote execution begins.
- SQLite aggregate, event and mutation ledger are atomic in the Node adapter.
- Concurrent workers use durable claims, leases and fences; a stale attempt cannot overwrite a newer revision.
- A lost response becomes `UNKNOWN`; it is never silently interpreted as `FAILED`.
- Verification and replay require explicit backend evidence and registered safety conditions.
- Backoff and Retry-After are durable scheduling data, never business evidence.

## Explicit limits

- The SDK cannot make a backend idempotent or determine a business outcome from HTTP alone.
- Expo storage has contract tests but still needs device-level crash and concurrency validation before production support.
- Background execution, dependency graphs, ordering guarantees, cloud telemetry and manual retry UI are not provided.
- Telemetry is best effort and not part of the durable commit boundary.

## Testing faults

`ChaosTransport` is a deterministic test adapter. Script errors for response loss or timeout, then assert that the operation reaches `UNKNOWN` and requires verification or explicitly safe replay. Storage integration tests additionally cover process kill, full disk and concurrent claims.
