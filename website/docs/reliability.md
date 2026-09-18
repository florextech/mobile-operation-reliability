---
sidebar_position: 4
---

# Reliability model

An Operation is written to durable storage before any remote execution. A
lease prevents concurrent workers from applying competing transitions. On
restart, expired leases are recovered conservatively and the scheduler rereads
durable state.

Retry is allowed only when the transport has evidence that the backend did not
apply the effect. Verification is used when the outcome is uncertain. A retry
policy is stored with the Operation so policy changes do not reinterpret
already-accepted work.

The SDK provides at-least-once delivery coordination. Backend idempotency is
required to turn that into safe business behavior. Mobile platforms may delay
or stop background execution, so the application must also wake the scheduler
when it starts, returns to foreground or receives an online network hint.
