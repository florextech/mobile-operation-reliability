# @florextech/core — Fase 1

Dominio TypeScript puro para Mobile Operation Reliability. Este paquete todavía no ejecuta operaciones ni confirma persistencia. No tiene dependencias de producción, imports de plataforma, red, timers, storage concreto o singletons.

## Superficie implementada

- `Operation`, `OperationId`, `OperationStatus`, `OperationEvent` y `OperationError`.
- `proposeAcceptance`: valida identidad, configuración y JSON; crea un snapshot inmutable y una propuesta de transacción inicial.
- `transition`: única función que propone cambios de lifecycle, claims, renovación, recovery y scheduling.
- `assertOperationInvariants`: comprueba invariantes de un snapshot tipado. No reemplaza un decoder de registros desconocidos.
- `sameIntent`: compara contenido canónico completo, sin deduplicación por semejanza ni hash corto.
- `validateRetryPolicy`, `nextRetryAt`, `isReplaySafe`: decisiones deterministas con tiempo y muestra de jitter explícitos.
- Contratos de `StoragePort`, `TransportPort`, `NetworkPort`, `ClockPort`, `TelemetryPort`.

## Uso del dominio

```ts
import { operationId, proposeAcceptance } from '@florextech/core';

const proposal = proposeAcceptance({
  id: operationId('id-generado-por-la-aplicacion'),
  type: 'payment.create',
  definitionVersion: '1',
  principalScope: 'account-1',
  targetScope: 'production',
  payload: { amount: 100, currency: 'COP' },
  idempotencyKey: null,
  policySnapshot: {
    execution: { maxAttempts: 3, timeoutMs: 15000, baseDelayMs: 1000, maxDelayMs: 30000 },
    verification: { maxAttempts: 0, timeoutMs: 15000, baseDelayMs: 1000, maxDelayMs: 30000 },
    replay: { kind: 'NONE' },
  },
}, 1000, 'mutation-id-generado-por-la-aplicacion', {
  maxBytes: 65536,
  maxDepth: 16,
});
```

Los números del ejemplo son ilustrativos. `proposal` **no es un recibo ACCEPTED**: contiene el estado que se propone persistir. Sólo el futuro `StoragePort.accept` puede confirmar ownership durable mediante COMMITTED o EXISTING. Si el commit es indeterminado, se resuelve por el mismo operationId/mutationId.

La validación específica del negocio corresponde a la definición versionada registrada por la integración. El snapshot JSON no puede determinar por sí solo si un monto es válido o si un campo contiene un secreto; la aplicación debe validar y minimizar sus datos.

### Transiciones y persistencia

`transition(snapshot, command, context)` devuelve `OperationChange`: nuevo snapshot, revisión esperada, mutationId y evento si cambió el estado. No modifica el input ni realiza I/O. Una transición inválida lanza `DomainError` con código estable.

El adapter debe leer el registro actual, revalidar las precondiciones, aplicar la función y persistir agregado/evento **en la misma transacción**. Calcular una propuesta en memoria no es obtener un lease. El dominio puede validar CAS/fencing, pero no puede proporcionar atomicidad entre procesos sin el adapter.

Los comandos disponibles son CLAIM, EXECUTION_RESULT, VERIFICATION_RESULT, RECOVER_EXPIRED, FAIL_LOCAL, RENEW y SCHEDULE. No existe SET_STATUS. Estados terminales rechazan todos los comandos. Las mutaciones sin cambio de estado incrementan revision y no generan eventos de transición ficticios.

### Seguridad de retry

`NOT_APPLIED` sólo resuelve el intento al que se refiere. Si existía incertidumbre previa, la operación vuelve a UNKNOWN. Sólo evidencia backend de alcance OPERATION puede confirmar el resultado global o descartar definitivamente todos los efectos anteriores.

Una garantía de replay es una referencia al contrato del backend, no una garantía creada por TypeScript. `readiness.replayContractVersion` debe identificar el contrato vigente que la integración comprobó. Para retención temporal se exige `clockTrusted`; la integración no debe afirmarlo si no puede acotar la incertidumbre del reloj. La clave y `firstExecutionAt` no se regeneran entre retries.

UNKNOWN puede proponer una consulta de verificación si queda presupuesto. Eso no ejecuta un verifier; el claim futuro exige que esté disponible. Sin él la coordinación deberá poner un hold o seleccionar un replay garantizado. Una pausa conserva la fecha programada para que quitarla no permita saltar Retry-After. Scheduling no otorga permiso de ejecución; las guardas se vuelven a comprobar al claim.

## Checks

Desde la raíz, con Node.js 24 y pnpm 10.11.0:

```sh
pnpm install --frozen-lockfile
pnpm check
```

`check` ejecuta TypeScript strict, ESLint, build y tests con `node:test`. El compilador del Core tiene sólo `ES2022`, sin tipos DOM ni Node. Los tests de tipos verifican readonly, estados vigentes y ausencia de operaciones de almacenamiento ciegas.

## Límites actuales

La fase 1 prueba decisiones del dominio. Durabilidad, commit indeterminado real, procesos concurrentes, recuperación tras process kill, mapeos REST y comportamiento móvil requieren adapters y suites de integración posteriores. Todavía no existe una API `submit`, engine, OperationHandle, scheduler ejecutable ni implementación de los puertos.

Ver [arquitectura](../../ARCHITECTURE.md), [ADRs vigentes](../../docs/adr/README.md) y [registro de implementación de fase 1](../../docs/PHASE_1.md).

Para validar todos los gates del repositorio antes de un commit: `pnpm quality:gate`. Incluye Semgrep Community, `pnpm audit` y SonarQube, además de los checks del paquete. Ver [gates de seguridad](../../docs/SECURITY_GATES.md).
