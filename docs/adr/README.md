# FlorexTech — Architecture Decision Records

[Arquitectura normativa](../../ARCHITECTURE.md). Los ADRs Accepted documentan decisiones de diseño; no afirman que exista implementación ni que las garantías estén verificadas. Los antecedentes se conservan para explicar cambios explícitos.

## Decisiones vigentes

| ADR | Decisión | Sustituye |
|---|---|---|
| [ADR-009](009-minimal-operation-state-machine.md) | Agregado durable y máquina de estados mínima | ADR-001 y ADR-003 |
| [ADR-010](010-durable-acceptance-and-fenced-storage.md) | Aceptación durable, CAS y leases con fencing | ADR-002, ADR-004 y ADR-006 |
| [ADR-011](011-evidence-safe-retry-and-verification.md) | Evidencia, retry seguro y verification | ADR-005, ADR-007 y ADR-008 |
| [ADR-012](012-hexagonal-runtime-ports.md) | Core portable y cinco puertos de efectos | Ninguno; consolida límites tras ADR-011 |
| [ADR-013](013-errors-identity-and-observation.md) | Errores explícitos, scopes y observación durable | Ninguno |
| [ADR-014](014-mvp-boundaries-and-validation.md) | MVP de reliability con seguridad desde el primer envío | Ninguno; acota el roadmap previo |

## Antecedentes sustituidos

| ADR histórico | Sustituido por |
|---|---|
| [ADR-001](001-operation-model.md) | [ADR-009](009-minimal-operation-state-machine.md) |
| [ADR-002](002-local-vs-remote-completion.md) | [ADR-010](010-durable-acceptance-and-fenced-storage.md) |
| [ADR-003](003-state-machine.md) | [ADR-009](009-minimal-operation-state-machine.md) |
| [ADR-004](004-durable-storage-contract.md) | [ADR-010](010-durable-acceptance-and-fenced-storage.md) |
| [ADR-005](005-transport-boundary.md) | [ADR-011](011-evidence-safe-retry-and-verification.md) |
| [ADR-006](006-concurrency-and-durable-leases.md) | [ADR-010](010-durable-acceptance-and-fenced-storage.md) |
| [ADR-007](007-idempotency-strategy.md) | [ADR-011](011-evidence-safe-retry-and-verification.md) |
| [ADR-008](008-unknown-outcomes-and-verification.md) | [ADR-011](011-evidence-safe-retry-and-verification.md) |

## Lectura e implementación

Leer ARCHITECTURE.md y los ADRs vigentes antes de implementar. La tabla de transiciones del documento es exhaustiva; los ejemplos TypeScript y estados de ADRs sustituidos no constituyen contratos. El roadmap es orientativo y no amplía el MVP. Cambios futuros de garantía requieren un nuevo ADR o una enmienda explícita.
