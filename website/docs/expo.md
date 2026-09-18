---
sidebar_position: 6
---

# Expo and React Native

`@florextech/storage-expo` provides an Expo SQLite adapter. It is separate from
Core so application code can choose its runtime integration without pulling
Expo into the reliability state machine.

The repository includes an Expo storefront example that demonstrates a durable
order operation, recovery after an interrupted response and status rendering.
Use it as a reference for composition and test scenarios, then replace its
fixture transport with your own backend mapping.

Mobile process lifetime is not guaranteed. Keep product state linked to the
Operation ID, open storage at app startup, and call the scheduler when the app
foregrounds or network becomes available.
