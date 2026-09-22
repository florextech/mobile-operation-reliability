# ADR-022: Retención conservadora y capacidad explícita en alpha

- **Estado:** Accepted.
- **Fecha:** 2026-09-18
- **Responsable:** MOR

## Decisión

El alpha no elimina Operations, eventos ni ledger automáticamente. Limita cada
payload mediante `PayloadLimits`, pero no declara una cuota total de base de
datos ni un mecanismo de compaction. Un fallo de almacenamiento conserva la
semántica de admisión o mutación fallida; nunca autoriza borrar registros ni
inferir un resultado remoto.

## Por qué

Un registro terminal puede ser la evidencia de idempotencia y un `UNKNOWN`
puede requerir verificación futura. Sin una ventana de retención del backend,
una política de auditoría del producto y un límite aplicado antes de aceptar, el
borrado automático puede duplicar efectos o borrar evidencia.

## Consecuencias

El alpha se limita a instalaciones donde una historia local creciente es
aceptable. Antes de producción prolongada, un ADR nuevo debe definir retención,
capacidad, comunicación de agotamiento, migración y reglas de backup. `UNKNOWN`
no podrá ser candidato a limpieza automática.
