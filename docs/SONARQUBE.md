# SonarQube Community local

SonarQube Community Build se ejecuta en Docker con PostgreSQL y volúmenes persistentes. El servidor se publica sólo en `127.0.0.1:9000`. Las imágenes de Compose están fijadas por digest para repetir el entorno. El scanner oficial seleccionado usa amd64; Docker Desktop en Apple Silicon lo ejecuta mediante emulación.

## Uso

```sh
pnpm install --frozen-lockfile
pnpm sonar:up
pnpm sonar:scan
pnpm sonar:status
```

- `sonar:up` genera secretos locales, inicia servicios, cambia la contraseña inicial de admin, crea el proyecto privado y prepara su Quality Gate.
- `sonar:scan` ejecuta typecheck, lint, tests con cobertura LCOV y el scanner Docker. Espera el resultado del gate y falla si no es OK.
- `sonar:status` consulta el último gate y sus métricas; guarda un reporte en `.sonar/report.json`.
- `sonar:down` detiene los servicios y conserva volúmenes. No utiliza `down -v`.

Dashboard: [Mobile Operation Reliability](http://localhost:9000/dashboard?id=mobile-operation-reliability).

El usuario local es `admin`. La contraseña generada y el token del proyecto están en `.sonar/local.json`, con permisos 0600 y excluido de Git. El token se entrega al scanner por variable de entorno; no se incluye en propiedades ni argumentos. No compartir ese archivo. Conservar `.sonar` mientras se conservan los volúmenes, para mantener las credenciales correspondientes a esta instalación.

## Gate aplicado

`Mobile Operation Reliability Strict` conserva las condiciones de `Sonar way` y añade condiciones sobre todo el código:

| Métrica global | Requisito |
|---|---|
| Coverage | >= 80% |
| Duplicated lines | <= 3% |
| Bugs | 0 |
| Vulnerabilities | 0 |
| Code smells | 0 |
| Security hotspots reviewed | 100%, cuando existan hotspots |

Las condiciones globales evitan que el primer análisis pase sólo por carecer de una referencia de código nuevo. No se desactivan reglas ni se excluyen archivos del SDK para obtener el resultado.

## Alcance de análisis y cobertura

Se analiza íntegramente `packages/core/src`; `packages/core/test` se registra como código de tests. Los comandos de administración local en `scripts` no forman parte del SDK. La cobertura se recoge con c8/V8 sobre el JavaScript compilado y se remapea al TypeScript mediante source maps. LCOV normaliza rutas relativas a la raíz para que el contenedor pueda resolverlas.

El gate estático complementa los tests; no prueba durabilidad ni comportamiento real de SQLite, HTTP o el runtime móvil. Esas implementaciones todavía no forman parte de la fase 1.

## Referencias

- [Instalación oficial con Docker y PostgreSQL](https://docs.sonarsource.com/sonarqube-community-build/server-installation/from-docker-image/set-up-and-start-container).
- [Cobertura JavaScript/TypeScript con LCOV](https://docs.sonarsource.com/sonarqube-community-build/analyzing-source-code/test-coverage/javascript-typescript-test-coverage).

## Resultado verificado — 2026-09-15

SonarQube Community Build `26.9.0.129388`. Analysis ID: `646b67a1-3d46-49c8-b993-c5526cfe7d5f`.

| Check | Resultado |
|---|---|
| Quality Gate Mobile Operation Reliability Strict | OK; todas las condiciones evaluadas pasan |
| Cobertura global Sonar | 98,9% |
| Cobertura de código nuevo | 94,1% |
| Duplicación global/nueva | 0% |
| Bugs / vulnerabilidades / code smells | 0 / 0 / 0 |
| Security hotspots | 0; no hay revisiones pendientes |
| Issues sin resolver | 0 |
| Tests | 99 pasando |
| Typecheck / lint / build | OK |

Se corrigieron los 7 hallazgos del primer análisis: se explicitó el orden estable de claves JSON, se eliminaron expresiones anidadas y se separaron validaciones/resultado de rechazo en funciones pequeñas. Se añadió una regresión para claves Unicode. No se cambiaron umbrales para ocultar hallazgos ni se marcaron issues como aceptados.

El análisis incluye el working tree pendiente de commit. Sonar advierte que no dispone de blame Git para los archivos nuevos; por eso este resultado no sustituye una futura ejecución de CI sobre un commit publicado.

## Gate combinado

`pnpm quality:gate` añade Semgrep Community y auditoría de dependencias a los checks de Sonar. Ver [SECURITY_GATES.md](SECURITY_GATES.md) para alcance, privacidad y comandos. Los resultados fechados arriba son históricos; cada commit requiere una ejecución sobre su contenido actual.
