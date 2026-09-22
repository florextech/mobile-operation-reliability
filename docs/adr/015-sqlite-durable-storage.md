# ADR-015: SQLite durable con transacciones y driver aislado

- **Estado:** Accepted — implementado y probado en Node; conformidad móvil pendiente.
- **Fecha:** 2026-09-16
- **Responsable:** MOR
- **Sustituye:** Ninguno. Concreta ADR-010 y StoragePort.

## Contexto

La fase 1 produce propuestas puras. Hace falta demostrar que aceptación, ownership y resultados sobreviven a reinicios sin separar estado y eventos. El Core no puede depender de SQLite ni del runtime. Expo todavía no es parte de esta fase.

## Decisión y por qué

1. **SQLiteOperationStore y driver Node separado.** Un contrato pequeño de conexión síncrona representa únicamente las operaciones SQL utilizadas. El Core sigue dependiendo de StoragePort; no introducimos repositorios genéricos ni un motor de sincronización. Separar el binding permite comprobar SQL y durabilidad ahora sin afirmar compatibilidad Expo no validada.
2. **Archivo dedicado, WAL y synchronous FULL.** COMMITTED requiere confirmación durable. El modo en memoria y los perfiles de rendimiento que debilitan fsync no cumplen ACCEPTED. fullfsync se habilita para plataformas que lo implementan. No se prometen garantías superiores a las del almacenamiento subyacente.
3. **BEGIN IMMEDIATE con revalidación interna.** La lectura y la transición pertenecen a la misma exclusión de escritor. Esto permite varios procesos sin usar locks JavaScript que no se compartirían. El reloj se toma bajo lock para que una espera no vuelva válida una lease vencida.
4. **Agregado, evento y ledger en una transacción.** Persistirlos por separado permitiría recibos sin estado o resultados imposibles de reconciliar. La clave de ledger es operación + mutationId y conserva la solicitud canónica y el resultado original. Cambiar el contenido de una solicitud requiere otro ID.
5. **COMMIT incierto es INDETERMINATE.** Un error de confirmación puede ocurrir después de persistir. Un rollback posterior no demuestra que el commit anterior no existió. Resolver por mutationId evita ejecutar de nuevo una mutación ya aplicada.
6. **Decodificación estricta y migración transaccional.** El disco contiene datos desconocidos, no objetos TypeScript confiables. Validar antes de usar evita que un registro roto autorice ejecución. Una migración incompleta no debe dejar schema parcialmente actualizado. Versiones futuras y bases ajenas se rechazan sin borrarlas.
7. **Consultas de candidatos por scope y keyset.** La paginación por identidad estable evita desplazamientos causados por cambios de estado. No sustituye el claim; una lectura puede quedar obsoleta inmediatamente. No agregamos scheduler ni orden global de negocio.

## Alternativas descartadas

- SQLite dentro del Core: acopla invariantes a runtime e impide tests puros.
- Leer, decidir y después guardar sin transacción: dos workers pueden adquirir el mismo trabajo.
- Guardar solo el último mutationId: no reconcilia un commit ambiguo seguido de otras mutaciones.
- Tratar cualquier excepción como rollback confirmado: convierte una incertidumbre local en una falsa certeza.
- ORM o repositorio genérico: no añade garantías y oculta las fronteras transaccionales que necesitamos probar.

## Consecuencias

El ledger duplica snapshots y crece sin retención automática, deliberadamente fuera del MVP. El driver Node es síncrono y `node:sqlite` es experimental en Node 24; no se declara listo para el hilo UI móvil. Cada conexión es exclusiva de su store. Las garantías requieren un archivo local con filesystem y hardware confiables; no incluyen corrupción arbitraria, backups incoherentes o dispositivos que ignoren fsync.

La suite usa SQLite real, competencia entre procesos, SIGKILL, SQLITE_FULL e inyección de fallos en el límite del driver. Las pruebas de corte eléctrico y conformidad en dispositivos móviles siguen pendientes del adapter móvil.

## Referencias

- [Arquitectura normativa](../../ARCHITECTURE.md)
- [SQLite: transacciones](https://sqlite.org/lang_transaction.html)
- [SQLite: PRAGMA synchronous y journal_mode](https://sqlite.org/pragma.html)
