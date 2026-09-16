# ADR-019: Verification autoritativa y replay condicionado por contrato

- **Estado:** Accepted — implementado en Core.
- **Fecha:** 2026-09-16
- **Responsable:** FlorexTech
- **Sustituye:** Ninguno. Concreta ADR-011.

## Contexto

El cliente no puede distinguir un timeout previo al envío de una respuesta perdida después de que el backend aplicó el efecto. Reintentar por defecto podría duplicar pagos, órdenes o cambios de inventario.

## Decisión

El engine procesa UNKNOWN programado para verification sólo con `TransportPort.verify` e integración que declare verifier disponible. El verifier retorna resultados semánticos: confirmación global completa, rechazo global definitivo, ausencia final o resultado inconcluso. Todas las mutaciones se someten a claim y fencing durables.

El replay desde UNKNOWN exige simultáneamente schedule execution, política de snapshot, clave cuando la política lo requiere, versión exacta de contrato y reloj confiable cuando hay retención. Las opciones del engine son atestaciones de la integración; los valores seguros por defecto deshabilitan verification y replay.

## Por qué

La verificación puede resolver una incertidumbre sin duplicar el efecto. La versión evita que una actualización local redefina silenciosamente una garantía antigua. Retención sin reloj confiable no protege contra una clave expirada; por eso se rechaza replay en ese caso. Mantener la decisión en el dominio permite probarla sin HTTP o SDK móvil.

## Consecuencias

APIs existentes sin lookup autoritativo ni idempotencia concurrente siguen pudiendo recibir el primer intento, pero pueden quedar UNKNOWN. La aplicación debe mostrar ese estado y no crear otra intención por automatismo. Una excepción de verifier no produce FAILED. No existe override que acepte riesgo de duplicado.

## Validación requerida

Probar backend aplicado con respuesta perdida, verifier que completa, ausencia final, pending/inconcluso, verifier ausente, restart UNKNOWN, red perdida durante verification, contrato vencido/diferente y key duplicada.
