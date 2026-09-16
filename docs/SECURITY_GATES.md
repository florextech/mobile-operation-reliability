# Gates de seguridad

El proyecto usa **Semgrep Community Edition + pnpm audit** en lugar de Snyk. No requiere cuenta ni token de Snyk/Semgrep. SonarQube mantiene el Quality Gate de calidad y cobertura.

## Comandos

```sh
pnpm quality:gate
```

El comando instala con lockfile congelado, inicia SonarQube, ejecuta seguridad, typecheck, lint, build, tests, cobertura, análisis Sonar y revisión del diff. Cualquier exit code no cero detiene la cadena. No crea commits.

Para ejecutar sólo seguridad:

```sh
pnpm security:check
# O por separado:
pnpm security:deps
pnpm security:code
```

## Dependencias

`security:deps` ejecuta `pnpm audit --audit-level low` sobre el lockfile del workspace, sin filtrar dependencias de desarrollo/producción ni ignorar advisories. Requiere conexión al registro; errores del registro bloquean el gate. Los resultados reflejan su base de vulnerabilidades al momento del análisis y no son equivalentes a la base de Snyk.

## Código

`security:code` ejecuta Semgrep CE **1.176.1**, con imagen Docker fijada por digest. Usa el snapshot completo de **74 reglas** de `p/typescript` guardado en `.semgrep/typescript.yaml`. Procedencia, hash y licencia upstream están en [.semgrep/PROVENANCE.md](../.semgrep/PROVENANCE.md); las reglas conservan su licencia propia.

El runner:

- Analiza todos los `packages/*/src` y los scripts JavaScript/TypeScript en `scripts`.
- Monta sólo esas fuentes y reglas en modo lectura; no monta `.sonar` ni sus credenciales.
- Ejecuta con `--network none`, métricas/version-check deshabilitados y sin login. La primera descarga de la imagen sí necesita Internet.
- Activa `--error`, `--strict` y `--disable-nosem`: no basta que el análisis termine; los hallazgos y errores bloquean el gate.
- Compara los archivos fuente esperados con `paths.scanned`, para evitar un verde obtenido por omisiones.
- Escribe `.security/semgrep.json`, ignorado por Git. No sube código ni resultados a un servicio Semgrep.

Los tests y archivos generados no son targets del análisis de seguridad de producto. Los nuevos paquetes con carpeta `src` se incluyen automáticamente; para otras extensiones/lenguajes hay que ampliar el inventario y las reglas antes de afirmar cobertura.

Semgrep CE y este ruleset no cubren todas las capacidades de análisis entre archivos de productos comerciales. Un gate verde significa que no se detectaron hallazgos con estas reglas; no garantiza ausencia de vulnerabilidades.

## Sonar local

Sonar se publica exclusivamente en `127.0.0.1:9000` y el script usa `http://localhost:9000`. La regla upstream de transporte inseguro exceptúa explícitamente `localhost`; se unificó el hostname del script y dashboard sin modificar la regla ni suprimir el hallazgo. HTTP sigue siendo local y sin TLS: esta configuración no debe trasladarse a un servidor remoto sin HTTPS.

Ver [SONARQUBE.md](SONARQUBE.md) para sus umbrales y administración.

## Mantenimiento

Actualizar motor y reglas de forma intencional, conservando digest, procedencia/licencia y ejecutando de nuevo los gates. No reducir severidades, quitar reglas o añadir ignores para obtener verde. La [skill de pre-commit](../.agents/skills/pre-commit-quality-gates/SKILL.md) define la evidencia requerida para cada commit.

## Verificación realizada — 2026-09-16

`pnpm quality:gate` terminó con exit code 0: audit sin vulnerabilidades conocidas, Semgrep con 74 reglas/10 archivos/cero hallazgos y cero errores, 99 tests pasando, typecheck/lint/build correctos y Sonar Quality Gate OK.

Sonar analysis ID: `8e16d17f-5010-463e-9f13-bb9faba41036`; cobertura global: 98.9%.

Se comprobó además el camino negativo: un archivo temporal con una petición HTTP externa insegura hizo fallar el gate de Semgrep. Se eliminó ese archivo y se repitió el gate completo sobre el proyecto limpio de la prueba. Los resultados son evidencia de esta ejecución, no sustituyen el gate del próximo commit.
