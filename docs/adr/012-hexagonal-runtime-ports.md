# ADR-012: Core portable y cinco puertos de efectos

- **Estado:** Accepted — diseño, pendiente de implementación y validación.
- **Fecha:** 2026-09-15
- **Responsable:** FlorexTech
- **Sustituye:** Ninguno; consolida límites tras ADR-011.

## Contexto

El primer runtime es React Native/Expo, pero durabilidad y semántica no deben depender de su lifecycle ni de librerías concretas. Abstraer todo también aumenta complejidad.

## Decisión

El Core contiene dominio puro y coordinación; declara StoragePort, TransportPort, NetworkPort, ClockPort y TelemetryPort. Adapters y composition root dependen del Core. NetworkPort sólo aporta hints; ClockPort aporta pared, monotónico y wakes controlables; TelemetryPort es no-op por defecto, best effort y fuera del commit. Definiciones versionadas se registran en memoria, sus referencias se persisten. No se crean puertos adicionales para ID, jitter o verificación.

## Por qué

Estos límites corresponden a efectos que necesitan sustitución en tests o runtimes. Funciones/valores explícitos bastan para las demás dependencias. Ningún detalle móvil debe alterar la máquina de estados.

## Alternativas descartadas

Se rechazan importar Fetch/SQLite/NetInfo en Core, persistir closures, usar eventos de red como fuente de verdad, event bus genérico y telemetry durable obligatoria.

## Consecuencias y límites

El runtime debe reconectar wake/foreground y registrar definiciones. Un timer puede perderse durante suspensión y un reloj puede saltar: storage se relee al despertar. La app puede usar un adapter de red siempre unknown.

## Validación requerida

Probar Core con reloj/red/transporte controlados, eventos perdidos, reloj discontinuo y sink que falla. Revisar dependencias para asegurar ausencia de imports de plataforma. Secciones 2 y 10 de ARCHITECTURE.md.

## Especificación normativa

[ARCHITECTURE.md](../../ARCHITECTURE.md).
