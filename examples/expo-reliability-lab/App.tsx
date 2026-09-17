import { useEffect, useState } from 'react';
import { Button, SafeAreaView, ScrollView, Text } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { OperationEngine, OperationScheduler, operationId } from '@florextech/core';
import type { Operation, TransportPort } from '@florextech/core';
import { AsyncSQLiteOperationStore } from '@florextech/storage-expo';

const policy = { execution: { maxAttempts: 3, timeoutMs: 10_000, baseDelayMs: 1_000, maxDelayMs: 10_000 }, verification: { maxAttempts: 3, timeoutMs: 10_000, baseDelayMs: 1_000, maxDelayMs: 10_000 }, replay: { kind: 'NONE' as const } };
const limits = { maxBytes: 65_536, maxDepth: 32 };

export default function App() {
  const [engine, setEngine] = useState<OperationEngine | null>(null); const [history, setHistory] = useState<string[]>([]);
  useEffect(() => { void bootstrap().then(value => { setEngine(value); setHistory(['Storage opened; the lab is ready.']); }).catch(error => setHistory([`Bootstrap failed: ${String(error)}`])); }, []);
  const accept = async () => {
    if (!engine) return;
    const id = operationId(`lab-${Date.now()}`); const handle = await engine.execute({ id, type: 'payment.create', definitionVersion: '1', payload: { amount: 10, currency: 'COP' }, principalScope: 'lab-user', targetScope: 'local', idempotencyKey: id, policySnapshot: policy });
    setHistory(previous => [`${handle.id}: ACCEPTED (durable local record)`, ...previous]);
  };
  return <SafeAreaView><ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}><Text>FlorexTech Reliability Lab</Text><Text>Esta app usa paquetes locales del workspace; no publica una librería.</Text><Button title="Accept payment operation" onPress={() => void accept()} disabled={!engine} />{history.map(line => <Text key={line}>{line}</Text>)}</ScrollView></SafeAreaView>;
}
async function bootstrap(): Promise<OperationEngine> {
  const database = await SQLite.openDatabaseAsync('mor-reliability-lab.db'); const store = new AsyncSQLiteOperationStore(database, { wallNow: () => Date.now() }, limits); const opened = await store.open(1); if (opened.kind === 'ERROR') throw new Error(opened.error.code);
  let sequence = 0; const transport: TransportPort = { async execute(context) { return { result: { kind: 'AMBIGUOUS', evidence: { operationId: context.operation.id, attemptId: context.attemptId, source: 'LOCAL', scope: 'ATTEMPT', observedAt: Date.now(), code: 'LAB_TRANSPORT_UNCONFIGURED' } } }; } };
  const engine = new OperationEngine({ storage: store, transport, clock: { wallNow: () => Date.now() }, limits, leaseDurationMs: 30_000, identifiers: { ownerId: 'expo-lab', nextMutationId: () => `m-${++sequence}`, nextAttemptId: () => `a-${sequence}` }, isDefinitionReady: () => true, areCredentialsReady: () => true, nextJitterSample: () => 0.5 });
  new OperationScheduler(engine, { principalScope: 'lab-user', targetScope: 'local' }, { scheduleWake: () => () => {} }); return engine;
}
