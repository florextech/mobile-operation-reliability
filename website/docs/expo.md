---
sidebar_position: 6
---

# Expo and React Native

`@florexlabs/storage-expo` provides an Expo SQLite adapter. It is separate from
Core so application code can choose its runtime integration without pulling
Expo into the reliability state machine.

The repository includes an Expo storefront example that demonstrates a durable
order operation, recovery after an interrupted response and status rendering.
Use it as a reference for composition and test scenarios, then replace its
fixture transport with your own backend mapping.

Mobile process lifetime is not guaranteed. Keep product state linked to the
Operation ID, open storage at app startup, and call the scheduler when the app
foregrounds or network becomes available.

## Development diagnostics

The reliability lab also includes a development-only inspector. It reads the
same durable records used by the scheduler and shows the scoped Operation list,
event timeline, counters and a redacted payload. It is visible only under
`__DEV__` and has no controls that mutate Operations.
