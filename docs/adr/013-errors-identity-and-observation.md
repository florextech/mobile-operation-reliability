# ADR-013: Errores explícitos, scopes y observación durable

- **Estado:** Accepted — diseño, pendiente de implementación y validación.
- **Fecha:** 2026-09-15
- **Responsable:** FlorexTech
- **Sustituye:** Ninguno.

## Contexto

Una DX basada sólo en promesas de éxito oculta la diferencia entre aceptación, espera agotada, fallo del SDK y rechazo de negocio. Credenciales cambiantes pueden enviar trabajo de otra cuenta.

## Decisión

Submit confirma posesión durable; observación y espera de resultado remoto son independientes y reconstruibles por ID. Un timeout del wait no cambia el estado. Los errores distinguen capa, certeza, alcance y acción; retryability no implica seguridad. Scope de principal/backend y versión de definición son inmutables. Las credenciales se resuelven al ejecutar y se comprueba su correspondencia. Payloads, tokens y respuestas crudas no van a telemetry.

## Por qué

Permite explicar al developer qué pasó sin inventar resultados remotos. Aislar identidad y scope evita ejecutar una intención aceptada en una sesión bajo otra cuenta.

## Alternativas descartadas

Se rechaza devolver éxito antes del commit, fallar el negocio por un timeout de UI, migrar payloads silenciosamente y persistir access tokens en la Operation.

## Consecuencias y límites

Los errores de configuración/storage pueden pausar progreso sin FAILED. Logout/stop no cancelan efectos en vuelo. Un handle se reconstruye; una promesa antigua no sobrevive. Se necesita minimización de datos desde el primer adapter.

## Validación requerida

Probar aceptación ambigua, receipt perdido, espera con UNKNOWN, definición faltante, cambio de cuenta y filtrado de datos sensibles. Secciones 3, 11 y 12 de ARCHITECTURE.md.

## Especificación normativa

[ARCHITECTURE.md](../../ARCHITECTURE.md).
