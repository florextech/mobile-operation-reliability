# ADR-021: Surface pública explícita para el alpha

- **Estado:** Accepted.
- **Fecha:** 2026-09-18
- **Responsable:** MOR

## Decisión

La primera publicación sólo soportará los package roots y subpaths enumerados
en [PUBLIC_API.md](../PUBLIC_API.md). `core/testing` es una superficie para
tests; `storage-sqlite/node` es específica de Node. El subpath `records` de
storage-sqlite queda interno y sin garantía de compatibilidad porque el adapter
Expo lo utiliza para compartir el codec estricto.

## Por qué

Una exportación con `export *` no convierte cada helper en una promesa de
soporte. Declarar el contrato de importación protege a consumidores de cambios
internos y permite corregir adapters alpha sin confundirlos con una API estable.

## Consecuencias

No se prometen hooks React, clientes HTTP, mapeos REST, lifecycle de Expo ni
singletons. Cambiar una API listada requiere changelog y notas de migración;
cambiar el formato durable requiere además migración y pruebas de compatibilidad.
