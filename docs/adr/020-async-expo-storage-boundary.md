# ADR-020: Storage Expo asíncrono requiere una frontera propia

- **Estado:** Accepted — adapter implementado; conformidad móvil pendiente.
- **Fecha:** 2026-09-16
- **Responsable:** FlorexTech

## Decisión

No se adaptará `expo-sqlite` a `SQLiteOperationStore` síncrono. `AsyncSQLiteOperationStore` conserva las garantías de StoragePort con transacciones exclusivas del driver Expo. Se validará en dispositivos antes de marcarlo productivo.

## Por qué

La sincronía de la interfaz interna Node permite que una transacción no se intercale. Convertir métodos async a llamadas no esperadas perdería esa propiedad; esperar fuera de una transacción separaría admission de sus registros auxiliares. La compatibilidad de tipo no prueba atomicidad ni durabilidad móvil.

## Consecuencias

La fase Expo no añade imports de plataforma al Core. Fetch, auth, red, AppState y hooks serán adapters delgados tras demostrar el store. La API web de expo-sqlite permanece fuera de la promesa inicial por ser alpha. El package recibe una interfaz estructural, para que la aplicación abra la base con Expo y el package no fuerce una versión o import de plataforma.
