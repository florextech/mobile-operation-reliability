# ADR-009: Agregado durable y máquina de estados mínima

- **Estado:** Accepted — diseño, pendiente de implementación y validación.
- **Fecha:** 2026-09-15
- **Responsable:** MOR
- **Sustituye:** ADR-001 y ADR-003.

## Contexto

Los estados originales incluían cola, retries, dependencias y cancelación. Mezclaban resultados del negocio con scheduling y permitían UNKNOWN → FAILED por política.

## Decisión

La identidad, payload, versión y scope son inmutables. El conjunto de estados es ACCEPTED, EXECUTING, UNKNOWN, VERIFYING, COMPLETED y FAILED. Scheduling y holds son datos, no estados. CREATED sólo existe antes de persistir. La tabla exhaustiva y las invariantes de ARCHITECTURE.md, secciones 3–5, son normativas. Se conserva unresolvedEffect durante replay: un fallo de un intento posterior no prueba que los anteriores no aplicaron.

## Por qué

Reduce combinaciones sin perder información y hace verificable la diferencia entre ausencia de efecto e incertidumbre. El estado describe hechos; los campos de programación explican cuándo intentar progresar.

## Alternativas descartadas

Se rechaza un estado por cada motivo de espera, incluir dependencias preventivamente y convertir UNKNOWN en fallo al agotar tiempo o intentos.

## Consecuencias y límites

Una operación puede permanecer UNKNOWN indefinidamente. No hay cancelación, reabrir terminales ni editar payloads aceptados. Los modelos anteriores son antecedentes, no contratos TypeScript vigentes.

## Validación requerida

Probar todos los pares de estados, guardas de evidencia global, terminalidad e incertidumbre acumulada.

## Especificación normativa

[ARCHITECTURE.md](../../ARCHITECTURE.md).
