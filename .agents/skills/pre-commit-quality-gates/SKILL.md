---
name: pre-commit-quality-gates
description: Ejecutar y verificar los gates de SonarQube, Semgrep Community, pnpm audit, lint, TypeScript, tests y build antes de crear o enmendar cualquier commit en mobile-operation-reliability.
---

# Gates antes de cada commit

Aplicar esta skill antes de `git commit`, incluidos commits de documentación y `--amend`, cuando el usuario haya autorizado el commit. La skill no autoriza por sí sola commits, pushes, publicaciones ni crear cuentas externas.

## Regla de cierre

Sólo crear el commit cuando todos los gates requeridos hayan terminado correctamente sobre el contenido que se va a commitear. Un check pendiente, omitido, no disponible, sin autenticación o con error es **BLOQUEADO**, nunca PASS. No reutilizar el verde histórico de otro análisis o de un contenido anterior.

Las instrucciones explícitas del usuario tienen precedencia. Si pide una excepción, registrar qué check omitió y por qué; no describir ese commit como «todos los gates verdes».

## Preparar el contenido y herramientas

1. Leer `ARCHITECTURE.md`, los ADRs vigentes que afecte el cambio y los scripts actuales de `package.json`. Ejecutar desde la raíz del repositorio.
2. Revisar `git status --short`, diff e índice. Preparar sólo los archivos autorizados. Mantener fuera `docs/FlorexTech_MOR_SDK_Roadmap_Fases_Prompts.md`, salvo instrucción explícita que cambie esa exclusión. No incluir `.sonar`, tokens, credenciales, coverage, dist ni node_modules.
3. Instalar dependencias con `pnpm install --frozen-lockfile`. Si falla, resolver la inconsistencia; no regenerar el lockfile silenciosamente para pasar el check. Un cambio intencional de dependencias debe incluir su lockfile y volver a validarse.
4. Comprobar Docker y pnpm. Semgrep Community se ejecuta con la imagen fijada por digest en `scripts/semgrep.mjs` y las reglas locales de `.semgrep`; no requiere instalación global, cuenta ni token. Docker puede necesitar descargar la imagen la primera vez; el análisis corre con `--network none`.
5. `pnpm audit` necesita acceso al registro para consultar vulnerabilidades del lockfile, incluidas dependencias de desarrollo. Un error de conexión no equivale a ausencia de vulnerabilidades. No usar ignores ni limitar el scan a producción.

La preparación puede modificar el contenido pendiente. Fijar el snapshot definitivo del índice **después** de estos cambios; `git write-tree` permite identificarlo sin crear un commit.

## Ejecutar los gates

Ejecutar desde la raíz:

```sh
pnpm quality:gate
```

El comando encadena instalación con lockfile congelado, inicio de Sonar, `security:check`, `sonar:scan` y validación del diff. `security:check` ejecuta `pnpm audit` y Semgrep; `sonar:scan` ejecuta typecheck, lint, build, tests y cobertura antes del scanner y espera el Quality Gate. No duplicar esas ejecuciones sin necesidad.

Para diagnosticar: `pnpm security:deps`, `pnpm security:code` y `pnpm sonar:status`. Ejecutar cada comando comprobando su código de salida. No ocultar errores con `|| true` ni perder el exit code mediante pipes o redirecciones seguidas de comandos exitosos.

| Gate | Evidencia requerida |
|---|---|
| TypeScript, lint y build | Comandos correspondientes completados con exit code 0 en el scan actual |
| Tests y cobertura | Suite completa ejecutada, cero fallos, reporte LCOV actual; no introducir skips ni exclusiones para pasar |
| SonarQube | Scanner actual con `QUALITY GATE STATUS: PASSED`; `qualityGate.status=OK` del mismo proyecto y análisis; todas las condiciones evaluadas OK |
| Dependencias | `pnpm security:deps` termina con exit code 0; audit sobre el lockfile completo, sin ignores ni filtros de producción |
| Semgrep Community | `pnpm security:code` termina con exit code 0, cero findings/errores y todos los archivos fuente esperados presentes en el reporte |
| Diff | `git diff --cached --check` sin errores y revisión de los archivos incluidos |

El proyecto Sonar es `florextech-mobile-operation-reliability`, con gate **FlorexTech Strict**. Consultar [SONARQUBE.md](../../../docs/SONARQUBE.md) para comandos, condiciones y alcance. Un `sonar:status` verde sin un scan actual no basta. Confirmar que el analysis ID/fecha pertenecen a la ejecución realizada, no sólo al SHA de HEAD: Sonar analiza el working tree y puede mostrar el commit anterior cuando existen cambios pendientes.

Semgrep analiza los `src` de los paquetes y los scripts JavaScript/TypeScript del proyecto. `scripts/semgrep.mjs` comprueba que no falten archivos, falla ante hallazgos/errores y deshabilita supresiones `nosem`. Usa el snapshot completo de 74 reglas de `p/typescript`, con metadata/licencia upstream, guardado en `.semgrep`. Consultar [SECURITY_GATES.md](../../../docs/SECURITY_GATES.md) para alcance y límites. No sustituirlo por unas pocas reglas propias que produzcan un verde artificial.

## Corregir y repetir

- Corregir la causa y agregar regresión cuando sea un defecto de comportamiento. Respetar la arquitectura y los contratos de durabilidad.
- No reducir umbrales, desactivar reglas, quitar archivos del análisis, introducir `NOSONAR`, añadir `nosemgrep` o ignores de audit ni limitar severidades para obtener verde. Una excepción necesita instrucción explícita del usuario y no equivale a un gate limpio.
- Cualquier exit code no cero de audit o Semgrep bloquea el gate; también lo bloquea un reporte incompleto aunque el proceso termine con cero. Corregir hallazgos reparables; si no hay remediación segura, informar y detener el commit.
- Si hay una caída transitoria, reintentar de forma acotada tras comprobar la causa. Si requiere conectividad, infraestructura o una decisión externa, dejar el commit pendiente e indicar el bloqueo; no insistir indefinidamente.
- Tras modificar código, tests, dependencias o configuración de checks, ejecutar de nuevo los gates afectados y obtener un análisis Sonar del contenido final. No presentar resultados anteriores como evidencia del nuevo snapshot.

## Verificar y commitear

1. Comprobar que los inputs analizados coinciden con el índice final. El árbol obtenido con `git write-tree` debe ser el validado; además, no debe haber cambios sin stage en código, tests, manifests o configuración que hayan alterado el análisis. Para un commit parcial con otros cambios del usuario, validar una copia aislada del índice sin descartar sus cambios.
2. Si cambió el contenido desde los checks, invalidar la evidencia afectada y repetir. No añadir modificaciones de última hora después de los gates.
3. Crear el commit autorizado y verificar su hash y estado restante.
4. Resumir hash, tests, typecheck/lint/build, audit, Semgrep y Sonar con analysis ID y métricas relevantes. No incluir secretos. Los reportes locales pueden permanecer en `.sonar` y `.security`, fuera de Git.

Esto es una obligación para agentes, no un hook de Git instalado: no garantiza bloquear commits hechos por otras herramientas.

## Referencias

- [Semgrep Community Edition](https://semgrep.dev/products/community-edition/).
- [pnpm audit](https://pnpm.io/cli/audit).
