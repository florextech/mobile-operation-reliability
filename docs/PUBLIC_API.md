# Public API for the alpha

This document freezes the import surface intended for the first public alpha.
Anything not listed here is an implementation detail and can change before a
stable release. Import only package roots; do not deep-import `dist` files.

| Package | Supported import | Purpose | Support level |
| --- | --- | --- | --- |
| `@florexlabs/core` | package root | Operation domain, ports, engine, scheduler and error types | Alpha public API |
| `@florexlabs/core/testing` | testing subpath | `FakeTransport` and `ChaosTransport` for consumer tests | Test-only API |
| `@florexlabs/storage-sqlite` | package root | `SQLiteOperationStore` and structural SQLite driver types | Alpha public API for Node-compatible SQLite drivers |
| `@florexlabs/storage-sqlite/node` | Node subpath | `createNodeSQLiteStore` and `NodeSQLiteConnection` | Node-only development and test adapter |
| `@florexlabs/storage-expo` | package root | `AsyncSQLiteOperationStore` and Expo SQLite structural types | Beta adapter; mobile conformance is incomplete |
| `@florexlabs/inspector` | package root | Read-only scoped diagnostics and redaction | Alpha public API |

## Explicit exclusions

`@florexlabs/storage-sqlite/records` is an internal compatibility bridge used
by the Expo adapter. Applications must not import it. It is exported only so
workspace packages can share the strict record codec without duplicating it;
it has no compatibility commitment.

The packages do not expose a React hook, a global singleton, a fetch client,
an Expo application lifecycle policy, or a backend-specific REST mapper. Those
belong in the consuming application because they carry credentials and business
semantics.

## Compatibility policy

Until `1.0.0`, a release may change alpha APIs when correctness, durability or
security requires it. Every change must update this document, the changelog and
the migration notes. A supported import must never be removed silently.

`Operation` records are durable data. Changes to their persisted shape require
an explicit storage migration and compatibility tests; a TypeScript-only change
is insufficient.
