# ADR-014: MVP de reliability con seguridad desde el primer envío

- **Estado:** Accepted — diseño, pendiente de implementación y validación.
- **Fecha:** 2026-09-15
- **Responsable:** MOR
- **Sustituye:** Ninguno; acota el roadmap previo.

## Contexto

El roadmap incluía dependencias, DevTools y cloud, y separaba ejecución de recuperación e incertidumbre en fases posteriores. Publicar ejecución durable sin estas guardas dejaría duplicados evitables.

## Decisión

El MVP incluye aceptación durable, estados semánticos, claims/fencing, recovery, retries seguros, verificación opcional, consulta/observación y cinco puertos. Las invariantes deben existir antes de habilitar un transporte real. Se difieren sync, DAGs, orden por entidad, cancelación/compensación, multi-device, cloud, blobs, GC automático y overrides inseguros. La matriz de riesgos y validación de ARCHITECTURE.md, secciones 13–15, define el alcance.

## Por qué

El valor mínimo es conservar intención y manejar incertidumbre correctamente. Funcionalidades adicionales no compensan una semántica insegura. El soporte futuro de runtimes se obtiene por límites, no implementando adapters sin demanda.

## Alternativas descartadas

Se rechaza tratar durability/recovery como hardening opcional de una cola HTTP y extender este producto hacia database synchronization.

## Consecuencias y límites

No se promete eventual completion ni ejecución en background garantizada. Sin retención automática el almacenamiento crece; el MVP rechaza nuevas admisiones al llegar a límites en vez de descartar operaciones aceptadas. Antes de producción prolongada hará falta un ADR de retención.

## Validación requerida

Toda garantía publicada requiere evidencia: tests de dominio y conformidad real de adapters, fallos entre commits y escenarios de respuesta perdida. Esta entrega sólo contiene documentación.

## Especificación normativa

[ARCHITECTURE.md](../../ARCHITECTURE.md).
