# ADR-010: Aceptación durable, CAS y leases con fencing

- **Estado:** Accepted — diseño, pendiente de implementación y validación.
- **Fecha:** 2026-09-15
- **Responsable:** FlorexTech
- **Sustituye:** ADR-002, ADR-004 y ADR-006.

## Contexto

Un commit puede ocurrir sin que llegue su respuesta. Un lease por owner y fecha no basta para rechazar resultados de workers antiguos. Un log escrito separado del estado puede mentir sobre lo que ocurrió.

## Decisión

ACCEPTED como recibo requiere commit confirmado de agregado y evento. Submit usa ID estable e inserción idempotente; commit indeterminado produce AcceptanceIndeterminate y se resuelve por el mismo ID. StoragePort lineariza claims y transiciones con revision, owner, attemptId y fence creciente. El resultado exige lease vigente. La recuperación de estados activos vencidos lleva a UNKNOWN. Las mutaciones tienen identidad para resolver commits ambiguos sin duplicarlas. El snapshot es autoridad; el journal mínimo es atómico, no event sourcing.

## Por qué

Cierra las carreras locales y hace recuperable el hueco entre persistir y responder al caller. El fencing impide sobrescrituras obsoletas; UNKNOWN reconoce el hueco inevitable entre store local y backend.

## Alternativas descartadas

Se rechazan mutex sólo en memoria, save ciego, release sin transición, appendEvent separado y reencolar directamente EXECUTING tras un crash.

## Consecuencias y límites

StoragePort requiere un adapter transaccional durable real. SQLite es el adapter inicial previsto, con librería/configuración por validar. Leases no eliminan concurrencia remota ni garantizan exactly-once. No se borran pendientes automáticamente.

## Validación requerida

Suite de conformidad sobre storage real: process kill, commit ambiguo, atomicidad de eventos, contención multi-conexión, fencing, renovación y expiración. Ver secciones 8–10 de ARCHITECTURE.md.

## Especificación normativa

[ARCHITECTURE.md](../../ARCHITECTURE.md).
