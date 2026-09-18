---
sidebar_position: 5
---

# Public alpha API

| Package | Public import |
| --- | --- |
| Core | `@florextech/core` and `@florextech/core/testing` |
| SQLite storage | `@florextech/storage-sqlite` and `@florextech/storage-sqlite/node` |
| Expo storage | `@florextech/storage-expo` |
| Inspector | `@florextech/inspector` |

Use the Core types to define Operations, ports and transitions. Use the
storage packages to supply the `StoragePort`; the application supplies its
transport and network adapters. The public contract is intentionally small so
that a future runtime can implement the same ports without coupling Core to a
mobile framework.

This is an alpha API. Follow the package changelog and migration guidance when
the first published version is released.
