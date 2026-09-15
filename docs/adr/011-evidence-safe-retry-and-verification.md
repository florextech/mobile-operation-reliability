# ADR-011: Evidencia, retry seguro y verification

- **Estado:** Accepted — diseño, pendiente de implementación y validación.
- **Fecha:** 2026-09-15
- **Responsable:** FlorexTech
- **Sustituye:** ADR-005, ADR-007 y ADR-008.

## Contexto

HTTP status, timeout e idempotency headers no demuestran el resultado del negocio. La ausencia observada no impide que una solicitud anterior llegue tarde.

## Decisión

TransportPort expone execute y verify opcional, con resultados semánticos distintos. COMPLETED exige confirmación backend correlacionada. FAILED exige ausencia de incertidumbre global y cierre definitivo. Retry desde UNKNOWN requiere garantía backend de replay vigente que cubra todos los intentos. FINAL_NOT_APPLIED requiere prueba de ausencia y de imposibilidad de ejecución tardía. Sin esas condiciones UNKNOWN permanece. No existe override de replay inseguro en el MVP.

## Por qué

La prevención de doble efecto depende de evidencia y cooperación backend, no de optimismo del cliente. Conservar la ambigüedad protege decisiones de negocio posteriores.

## Alternativas descartadas

Se rechaza retry automático de todos los 5xx, interpretar 202 como finalización, interpretar 404 como ausencia definitiva, renovar la retención de claves con cada retry y asumir at-least-once remoto incondicional.

## Consecuencias y límites

Las APIs existentes sin esas capacidades siguen pudiendo recibir el primer intento, pero algunas operaciones no podrán resolverse automáticamente. El contrato de idempotencia debe detallar scope, simultaneidad, retención, payload y resultado. Los budgets execution/verification son separados y durables.

## Validación requerida

Simular efecto confirmado con respuesta perdida, 404 antes de llegada tardía, clave vencida y replay rechazado que deja una ambigüedad anterior. Secciones 6, 7 y 10.2 de ARCHITECTURE.md.

## Especificación normativa

[ARCHITECTURE.md](../../ARCHITECTURE.md).
