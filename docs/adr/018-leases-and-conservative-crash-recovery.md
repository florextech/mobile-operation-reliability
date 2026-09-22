# ADR-018: Leases renovables y recovery conservador de procesos muertos

- **Estado:** Accepted — implementado y probado con SQLite real.
- **Fecha:** 2026-09-16
- **Responsable:** MOR
- **Sustituye:** Ninguno. Concreta ADR-010.

## Contexto

Dos activaciones del runtime o dos procesos pueden observar la misma Operation. Un proceso puede morir después de reservarla y antes o durante una llamada remota. El SDK necesita recuperar progreso sin asumir que el servidor no recibió nada.

## Decisión

StoragePort conserva lease con owner, fence y expiración junto a la revisión y el intento. Claims, renewals, resultados y recovery son mutaciones CAS. El engine renueva sólo sus propias leases cerca de la expiración; nunca revive una vencida. Todo barrido recupera leases vencidas de cualquier owner a UNKNOWN. El recovery no reclama de nuevo ni invoca transporte.

## Por qué

La transacción durable decide el único owner entre procesos; los mutexes del runtime no lo hacen. Fencing invalida resultados del worker anterior. UNKNOWN tras expiración protege contra el punto indetectable entre reservar y emitir bytes. La renovación separada impide retener una transacción local durante una operación de red.

## Consecuencias

La aplicación debe programar barridos antes de que caduque la lease si desea reducir recuperaciones conservadoras. Una suspensión prolongada causa UNKNOWN al reiniciar. La recuperación no garantiza entrega al backend ni evita que una request en vuelo llegue tarde. La siguiente fase resuelve UNKNOWN únicamente con evidencia de verification o replay seguro.

## Validación requerida

Probar contención de múltiples procesos sobre SQLite, owner/fence/attempt obsoletos, renovación, expiración, crash SIGKILL antes/después de commit y que terminales nunca sean reclaimed.
