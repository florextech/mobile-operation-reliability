import { useEffect, useState } from 'react';
import { Button, SafeAreaView, ScrollView, Text } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { OperationEngine, OperationScheduler, operationId } from '@florextech/core';
import type { OperationId } from '@florextech/core';
import { AsyncSQLiteOperationStore } from '@florextech/storage-expo';
import { createLabTransport } from './src/lab-transport';

const policy = { execution: { maxAttempts: 3, timeoutMs: 10_000, baseDelayMs: 1_000, maxDelayMs: 10_000 }, verification: { maxAttempts: 3, timeoutMs: 10_000, baseDelayMs: 1_000, maxDelayMs: 10_000 }, replay: { kind: 'NONE' as const } };
const limits = { maxBytes: 65_536, maxDepth: 32 };
const scenario = { principalScope: 'e2e-response-loss', targetScope: 'local' };
interface LabRuntime { readonly engine: OperationEngine; readonly scheduler: OperationScheduler; readonly store: AsyncSQLiteOperationStore; readonly database: SQLite.SQLiteDatabase }

export default function App() {
  const [runtime, setRuntime] = useState<LabRuntime | null>(null); const [history, setHistory] = useState<string[]>([]);
  const refresh = async (value: LabRuntime) => { const ids = await caseIds(value.database); const lines = await Promise.all(ids.map(async id => { const status = await value.store.get({ id, ...scenario }); return `${id}: ${status.kind === 'OK' ? status.value?.status ?? 'MISSING' : status.error.code}`; })); setHistory(lines); };
  useEffect(() => { void bootstrap().then(async value => { setRuntime(value); await refresh(value); }).catch(error => setHistory([`Bootstrap failed: ${String(error)}`])); }, []);
  const accept = async () => {
    if (!runtime) return;
    const id = operationId(`lab-${Date.now()}`); const handle = await runtime.engine.execute({ id, type: 'payment.create', definitionVersion: '1', payload: { amount: 10, currency: 'COP' }, ...scenario, idempotencyKey: id, policySnapshot: policy });
    await runtime.database.runAsync('INSERT OR IGNORE INTO lab_e2e_cases(id) VALUES(?)', [handle.id]); await refresh(runtime); await runtime.scheduler.run(); await refresh(runtime);
  };
  const recover = async () => { if (!runtime) return; await runtime.scheduler.run(); await refresh(runtime); };
  return <SafeAreaView><ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}><Text>FlorexTech Reliability Lab</Text><Text>Scenario scope: {scenario.principalScope}</Text><Text>Esta app usa paquetes locales del workspace; no publica una librería.</Text><Button title="Accept payment operation" onPress={() => void accept()} disabled={!runtime} /><Button title="Run recovery / verification" onPress={() => void recover()} disabled={!runtime} />{history.length === 0 ? <Text>Storage opened; no scenario operations yet.</Text> : history.map(line => <Text key={line}>{line}</Text>)}</ScrollView></SafeAreaView>;
}
async function bootstrap(): Promise<LabRuntime> {
  const database = await SQLite.openDatabaseAsync('mor-reliability-lab.db'); const store = new AsyncSQLiteOperationStore(database, { wallNow: () => Date.now() }, limits); const opened = await store.open(1); if (opened.kind === 'ERROR') throw new Error(opened.error.code);
  await database.execAsync('CREATE TABLE IF NOT EXISTS lab_e2e_cases (id TEXT PRIMARY KEY NOT NULL) STRICT;');
  let sequence = 0; const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`; const transport = createLabTransport({ baseUrl: process.env.EXPO_PUBLIC_FIXTURE_URL ?? 'http://127.0.0.1:3000' });
  const engine = new OperationEngine({ storage: store, transport, clock: { wallNow: () => Date.now() }, limits, leaseDurationMs: 30_000, identifiers: { ownerId: `expo-lab-${runId}`, nextMutationId: () => `m-${runId}-${++sequence}`, nextAttemptId: () => `a-${runId}-${sequence}` }, isDefinitionReady: () => true, areCredentialsReady: () => true, isVerifierAvailable: () => true, nextJitterSample: () => 0.5 });
  const scheduler = new OperationScheduler(engine, scenario, { scheduleWake: () => () => {} }); return { engine, scheduler, store, database };
}
async function caseIds(database: SQLite.SQLiteDatabase): Promise<readonly OperationId[]> { return (await database.getAllAsync<{ id: string }>('SELECT id FROM lab_e2e_cases ORDER BY id DESC', [])).map(row => operationId(row.id)); }
