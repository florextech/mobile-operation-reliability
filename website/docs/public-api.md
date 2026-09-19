---
sidebar_position: 5
---

# Public alpha API

| Package | Public import |
| --- | --- |
| Core | `@florexlabs/core` and `@florexlabs/core/testing` |
| SQLite storage | `@florexlabs/storage-sqlite` and `@florexlabs/storage-sqlite/node` |
| Expo storage | `@florexlabs/storage-expo` |
| Inspector | `@florexlabs/inspector` |

Use the Core types to define Operations, ports and transitions. Use the
storage packages to supply the `StoragePort`; the application supplies its
transport and network adapters. The public contract is intentionally small so
that a future runtime can implement the same ports without coupling Core to a
mobile framework.

This is an alpha API. Follow the package changelog and migration guidance when
the first published version is released.
