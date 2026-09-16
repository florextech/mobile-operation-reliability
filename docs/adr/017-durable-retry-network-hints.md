# ADR-017: Retry durable y red como señal no autoritativa

- **Estado:** Accepted — implementado en Core.
- **Fecha:** 2026-09-16
- **Responsable:** FlorexTech
- **Sustituye:** Ninguno. Concreta ADR-011 y ADR-012.

## Contexto

Una app móvil puede perder conectividad, reiniciarse entre intentos o recibir Retry-After. Mantener la fecha de retry, el jitter o el conteo sólo en timers locales reintentaría demasiado pronto al reiniciar. Tratar una señal online como éxito remoto sería igualmente incorrecto.

## Decisión

El cálculo de backoff y budgets sigue en el dominio; el store persiste su schedule en cada transición. El engine inyecta una muestra de jitter y pasa el `retryAfterAt` interpretado por el adapter. La transición elige la fecha más tardía. TransportPort envuelve su resultado semántico en `TransportResponse` para transportar esta restricción temporal sin convertirla en evidencia.

NetworkPort se usa sólo para evitar claims nuevos cuando declara offline y para despertar el scheduler al volver online. El scheduler vuelve a leer StoragePort y claim revalida fecha, scope, lease, budget y resto de guardas. No se guarda la conectividad ni se añade un estado RETRYING.

## Por qué

Persistir la fecha evita storms después de restart y permite pruebas deterministas. El jitter inyectado evita fuente global oculta y queda fijado con la transición. Releer y reclamar tras reconnect evita que dos callbacks o una señal obsoleta ejecuten el mismo trabajo. Mantener la red fuera de evidencia protege la separación entre disponibilidad local y resultado de negocio.

## Consecuencias y límites

Los adaptadores deben convertir Retry-After a timestamp seguro antes de entregarlo. Si no pueden hacerlo, lo omiten. Offline puede estar equivocado; por ello el engine no cambia la semántica de la operación ni cancela un intento activo. UNKNOWN no se reintenta desde esta fase y puede permanecer detenido hasta verification/replay seguro. No se prometen wakeups durante suspensión del sistema operativo.

## Validación requerida

Probar backoff acotado, límites de jitter, Retry-After mayor al backoff, restart antes de la fecha, offline→online y múltiples operaciones vencidas. Confirmar que reconnect no borra schedule ni consume budget.
