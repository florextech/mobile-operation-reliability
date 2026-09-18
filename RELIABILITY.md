# Reliability limits and retention policy

## Demonstrated guarantees

- Acceptance is committed before remote execution begins.
- SQLite aggregate, event and mutation ledger are atomic in the Node adapter.
- Concurrent workers use durable claims, leases and fences; a stale attempt
  cannot overwrite a newer revision.
- A lost response becomes `UNKNOWN`; it is never silently interpreted as
  `FAILED`.
- Verification and replay require explicit backend evidence and registered
  safety conditions.
- Backoff and Retry-After are durable scheduling data, never business evidence.

The Expo adapter has contract tests and an iOS Simulator recovery run. Android,
physical-device crash and controlled-storage-failure conformance remain pending.

## What is retained

The alpha retains every accepted Operation, its transition events and mutation
ledger for the lifetime of its local database. This includes `COMPLETED`,
`FAILED` and unresolved `UNKNOWN` records. There is intentionally no automatic
deletion, TTL, compaction, export/import or public delete API.

**Why:** deleting a durable record can erase the evidence needed to reconcile a
lost acknowledgement, preserve idempotency, or explain a terminal result.
Automatic cleanup would be unsafe without a backend retention contract and a
product decision about audit history.

## Capacity policy

Each accepted input is bounded by the configured `PayloadLimits` (`maxBytes`
and `maxDepth`); the adapter snapshots and validates it before acceptance. The
SDK does not currently impose a total database byte quota or record-count quota.
Native storage exhaustion is reported as a failed admission or mutation by the
adapter; it never authorizes deletion or changes a business outcome.

For this alpha, run the SDK only where the application can tolerate an
unbounded local history for its installation lifetime. Treat available device
storage as an operational dependency and surface admission errors to the user
or support workflow. Do not clear the operation database as routine cleanup.

## Before sustained production use

A product-specific retention ADR must define all of the following before adding
cleanup:

1. Backend idempotency-key and verification-evidence retention windows.
2. Which terminal evidence may be removed, and after what auditable period.
3. A total capacity limit enforced **before** durable acceptance, with an
   explicit `StorageCapacityExceeded`-style admission outcome.
4. How the app informs users and support staff when capacity is exhausted.
5. Migration, backup and restore rules that cannot reintroduce stale IDs.

`UNKNOWN` must never be removed by an automatic quota policy. If its outcome
cannot be verified, it remains a business uncertainty rather than becoming a
failure through cleanup.

## Runtime limits

`ACCEPTED` confirms local durable possession only. It does not promise backend
completion, background execution while the OS suspends the app, exactly-once
delivery, cross-device coordination, backup recovery, or resolution of an API
that lacks idempotency and verification. See [ARCHITECTURE.md](ARCHITECTURE.md)
and [the backend contract guide](docs/BACKEND_IDEMPOTENCY.md).

## Testing faults

`ChaosTransport` is a deterministic test adapter. Script response loss or a
timeout, then assert that the operation reaches `UNKNOWN` and requires
verification or explicitly safe replay. Storage integration tests additionally
cover process kill, full disk and concurrent claims in the Node adapter.
