# ADR-016: Motor de ejecución coordinado por claims durables

- **Estado:** Accepted — implementado en Core; transport y runtime concretos pendientes.
- **Fecha:** 2026-09-16
- **Responsable:** MOR
- **Sustituye:** Ninguno. Concreta ADR-010, ADR-011 y ADR-012.

## Contexto

Storage ya puede aceptar, reclamar y transicionar una Operation. Sin una capa de aplicación, cada runtime tendría que repetir el orden crítico entre admission, claim, transporte y persistencia de resultado. Ese orden es parte de la garantía, no un detalle del adapter.

## Decisión

El Core expone un `OperationEngine` que recibe StoragePort, TransportPort, ClockPort, límites, identity factory, readiness de definición/credenciales, duración de lease y telemetry opcional. `execute` acepta primero y devuelve un `OperationHandle` sólo con COMMITTED/EXISTING. Un scheduler ligero lee candidatos por scope, pero el engine reclama dentro de Storage antes de cada llamada externa.

Tras un claim `EXECUTING` confirmado, el engine llama una vez a `TransportPort.execute` y persiste su resultado con ownership actual. Una excepción del adapter se convierte en evidencia local ambigua para el intento y llega a UNKNOWN. Telemetry se aísla y no puede impedir la transición. Handles leen storage y ofrecen espera local de COMPLETED/FAILED; no almacenan estado crítico.

## Por qué

El claim durable antes de I/O evita ejecutar dos veces por dos schedulers que observaron el mismo candidato. Convertir una excepción en incertidumbre conserva la semántica distribuida: el adapter puede haber emitido bytes aunque su promesa falle. Inyectar identidad y tiempo mantiene portabilidad y pruebas reproducibles. Un scheduler caller-driven evita prometer background execution o usar timers de plataforma en Core.

## Consecuencias y límites

La fase sólo ejecuta ACCEPTED. No activa verification, replay desde UNKNOWN, retry/network recovery, renovación/recovery de leases, polling cross-process, React hooks ni adapters REST. `confirmed()` no es una garantía de progreso y puede permanecer pendiente. Un runtime debe conservar el ID estable y volver a consultar tras reinicio o una admisión ambigua.

## Validación requerida

Probar que el transporte nunca se invoca antes de aceptar y reclamar, que una excepción termina UNKNOWN, que los terminales resuelven handles correctamente y que un engine recreado descubre trabajo durable. Los adapters concretos requieren pruebas propias de contrato.
