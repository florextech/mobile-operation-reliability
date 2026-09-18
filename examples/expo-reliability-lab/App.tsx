import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { OperationEngine, OperationScheduler, operationId } from '@florextech/core';
import type { OperationId, OperationStatus } from '@florextech/core';
import { OperationInspector, type OperationDetail } from '@florextech/inspector';
import { AsyncSQLiteOperationStore } from '@florextech/storage-expo';
import { createLabTransport } from './src/lab-transport';
import { connectLifecycle, ExpoNetworkHint } from './src/mobile-runtime';

const policy = { execution: { maxAttempts: 3, timeoutMs: 10_000, baseDelayMs: 1_000, maxDelayMs: 10_000 }, verification: { maxAttempts: 3, timeoutMs: 10_000, baseDelayMs: 1_000, maxDelayMs: 10_000 }, replay: { kind: 'NONE' as const } };
const limits = { maxBytes: 65_536, maxDepth: 32 };
const scenario = { principalScope: 'e2e-response-loss', targetScope: 'local' };
const fixtureUrl = process.env.EXPO_PUBLIC_FIXTURE_URL ?? 'http://127.0.0.1:3000';
const statusTone: Record<OperationStatus, keyof typeof styles> = { ACCEPTED: 'accepted', EXECUTING: 'executing', UNKNOWN: 'unknown', VERIFYING: 'verifying', COMPLETED: 'completed', FAILED: 'failed' };
interface LabRuntime { readonly engine: OperationEngine; readonly scheduler: OperationScheduler; readonly store: AsyncSQLiteOperationStore; readonly database: SQLite.SQLiteDatabase; readonly close: () => void }
interface OperationRow { readonly id: OperationId; readonly status: OperationStatus | 'MISSING' | 'ERROR'; readonly events: number }
type FixtureMode = '429' | '503' | 'drop-after-apply';

export default function App() {
  const [runtime, setRuntime] = useState<LabRuntime | null>(null);
  const [rows, setRows] = useState<readonly OperationRow[]>([]);
  const [showInspector, setShowInspector] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<OperationDetail | null>(null);
  const [notice, setNotice] = useState('Opening durable operation store…');
  const [busy, setBusy] = useState(false);
  const refresh = async (value: LabRuntime) => {
    const inspector = inspectorFor(value);
    const ids = await caseIds(value.database);
    const nextRows = await Promise.all(ids.map(async id => {
      const detail = await inspector.detail({ id, ...scenario });
      if (detail.kind === 'ERROR') return { id, status: 'ERROR' as const, events: 0 };
      if (detail.value === null) return { id, status: 'MISSING' as const, events: 0 };
      return { id, status: detail.value.operation.status, events: detail.value.events.length };
    }));
    setRows(nextRows);
  };
  const inspect = async (id: OperationId) => {
    if (!runtime || busy) return;
    setBusy(true); setNotice(`Reading durable timeline for ${id}…`);
    try {
      const detail = await inspectorFor(runtime).detail({ id, ...scenario });
      if (detail.kind === 'ERROR') throw new Error(detail.error.code);
      if (detail.value === null) throw new Error('Operation is no longer available in this scope');
      setSelectedDetail(detail.value); setNotice('Inspector loaded from durable storage.');
    } catch (error) { setNotice(`Inspector failed: ${String(error)}`); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let active: LabRuntime | null = null;
    void bootstrap().then(async value => { active = value; setRuntime(value); await refresh(value); setNotice('Store ready. Each action first writes a durable business operation.'); }).catch(error => setNotice(`Bootstrap failed: ${String(error)}`));
    return () => active?.close();
  }, []);
  const perform = async (label: string, action: () => Promise<void>) => {
    if (!runtime || busy) return;
    setBusy(true); setNotice(label);
    try { await action(); await refresh(runtime); setNotice('Operation state refreshed from durable storage.'); }
    catch (error) { setNotice(`Action failed: ${String(error)}`); }
    finally { setBusy(false); }
  };
  const accept = async () => {
    if (!runtime) return;
    const id = operationId(`lab-${Date.now()}`);
    const handle = await runtime.engine.execute({ id, type: 'payment.create', definitionVersion: '1', payload: { amount: 10, currency: 'COP' }, ...scenario, idempotencyKey: id, policySnapshot: policy });
    await runtime.database.runAsync('INSERT OR IGNORE INTO lab_e2e_cases(id) VALUES(?)', [handle.id]);
    await runtime.scheduler.run();
  };
  const injectAndAccept = async (mode: FixtureMode) => { await selectFixtureMode(mode); await accept(); };
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.hero}><Text style={styles.eyebrow}>FLOREXTECH · RELIABILITY LAB</Text><Text style={styles.title}>Payment operations</Text><Text style={styles.subtitle}>A local, durable workflow for testing how mobile operations behave when the network is unreliable.</Text></View>
    <View style={styles.healthCard}><View style={styles.healthDot} /><View style={styles.healthCopy}><Text style={styles.healthTitle}>{runtime ? 'Durable store online' : 'Starting store'}</Text><Text style={styles.healthText}>{scenario.principalScope} · {scenario.targetScope}</Text></View>{busy ? <ActivityIndicator color="#7dd3fc" /> : null}</View>
    <Text style={styles.notice}>{notice}</Text>
    <Section title="Create a payment" description="Normal flow: accept locally, then let the scheduler execute it."><ActionButton title="Create payment · COP 10" detail="Normal backend response" tone="primary" disabled={!runtime || busy} onPress={() => void perform('Accepting durable payment operation…', accept)} /></Section>
    <Section title="Inject a failure" description="These controls affect only the local fixture and preserve the operation contract.">
      <ActionButton title="Rate limited" detail="Inject HTTP 429 and Retry-After" disabled={!runtime || busy} onPress={() => void perform('Injecting rate limit and accepting operation…', () => injectAndAccept('429'))} />
      <ActionButton title="Temporary backend error" detail="Inject HTTP 503" disabled={!runtime || busy} onPress={() => void perform('Injecting temporary backend error…', () => injectAndAccept('503'))} />
      <ActionButton title="Lose response after apply" detail="Backend applies once; client observes UNKNOWN" tone="warning" disabled={!runtime || busy} onPress={() => void perform('Injecting response loss after backend apply…', () => injectAndAccept('drop-after-apply'))} />
    </Section>
    <Section title="Recover" description="Re-read durable work and verify uncertain operations against the backend."><ActionButton title="Run recovery and verification" detail="Never replays an UNKNOWN operation blindly" tone="secondary" disabled={!runtime || busy} onPress={() => void perform('Running scheduler recovery and verification…', () => runtime!.scheduler.run())} /></Section>
    {__DEV__ ? <Section title="Developer inspector" description="Read-only diagnostics from durable storage. Payload fields with token-like names are redacted.">
      <ActionButton title={showInspector ? 'Hide operation inspector' : 'Open operation inspector'} detail="List operations, select one and read its durable timeline" tone="secondary" disabled={!runtime || busy} onPress={() => { setShowInspector(value => !value); setSelectedDetail(null); }} />
      {showInspector ? <><View style={styles.listHeader}><Text style={styles.sectionTitle}>Operations</Text><Text style={styles.count}>{rows.length}</Text></View>
        {rows.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>No operations yet</Text><Text style={styles.emptyText}>Create a payment to inspect its durable status and event timeline.</Text></View> : rows.map(row => <OperationCard key={row.id} row={row} disabled={busy} onPress={() => void inspect(row.id)} />)}
        {selectedDetail ? <OperationDetailPanel detail={selectedDetail} onClose={() => setSelectedDetail(null)} /> : null}
      </> : null}
    </Section> : null}
    <Text style={styles.footer}>Local workspace packages · fixture URL: {fixtureUrl}</Text>
  </ScrollView></SafeAreaView>;
}
function Section({ title, description, children }: { readonly title: string; readonly description: string; readonly children: React.ReactNode }) { return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionDescription}>{description}</Text>{children}</View>; }
function ActionButton({ title, detail, tone = 'neutral', disabled, onPress }: { readonly title: string; readonly detail: string; readonly tone?: 'primary' | 'secondary' | 'warning' | 'neutral'; readonly disabled: boolean; readonly onPress: () => void }) { return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, tone === 'primary' ? styles.actionPrimary : tone === 'secondary' ? styles.actionSecondary : tone === 'warning' ? styles.actionWarning : styles.actionNeutral, disabled ? styles.disabled : null, pressed ? styles.pressed : null]}><View><Text style={styles.actionTitle}>{title}</Text><Text style={styles.actionDetail}>{detail}</Text></View><Text style={styles.actionArrow}>›</Text></Pressable>; }
function OperationCard({ row, disabled, onPress }: { readonly row: OperationRow; readonly disabled: boolean; readonly onPress: () => void }) { const tone = row.status in statusTone ? styles[statusTone[row.status as OperationStatus]] : styles.failed; return <Pressable accessibilityRole="button" accessibilityLabel={`Inspect operation ${row.id}`} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.operationCard, disabled ? styles.disabled : null, pressed ? styles.pressed : null]}><View style={[styles.statusPill, tone]}><Text style={styles.statusText}>{row.status}</Text></View><Text style={styles.operationId} numberOfLines={1}>{row.id}</Text><Text style={styles.eventText}>{row.events} durable {row.events === 1 ? 'event' : 'events'} · Inspect ›</Text></Pressable>; }
function OperationDetailPanel({ detail, onClose }: { readonly detail: OperationDetail; readonly onClose: () => void }) { const operation = detail.operation; return <View style={styles.detailPanel}><View style={styles.detailHeader}><View><Text style={styles.detailTitle}>{operation.type}</Text><Text style={styles.detailMeta}>{operation.status} · revision {operation.revision}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close operation detail" onPress={onClose}><Text style={styles.close}>Close</Text></Pressable></View><Text style={styles.operationId}>{operation.id}</Text><Text style={styles.detailMeta}>Execution {operation.executionCount}/{operation.policySnapshot.execution.maxAttempts} · Verification {operation.verificationCount}/{operation.policySnapshot.verification.maxAttempts}</Text>{operation.activeAttempt ? <Text style={styles.detailMeta}>Active {operation.activeAttempt.kind} attempt #{operation.activeAttempt.ordinal} · deadline {formatTime(operation.activeAttempt.deadlineAt)}</Text> : null}{operation.schedule ? <Text style={styles.detailMeta}>Next {operation.schedule.kind}: {formatTime(operation.schedule.at)}</Text> : null}{operation.holdReason ? <Text style={styles.detailMeta}>Hold: {operation.holdReason}</Text> : null}<Text style={styles.detailSection}>Durable timeline</Text>{detail.events.map(event => <View key={`${event.revision}-${event.mutationId}`} style={styles.eventRow}><Text style={styles.eventTime}>{formatTime(event.occurredAt)}</Text><View style={styles.eventCopy}><Text style={styles.eventTransition}>{event.from ?? 'NEW'} → {event.to}</Text><Text style={styles.detailMeta}>{event.trigger}{event.attemptId ? ` · ${event.attemptId}` : ''}</Text></View></View>)}<Text style={styles.detailSection}>Redacted payload</Text><Text selectable style={styles.payload}>{JSON.stringify(detail.payload, null, 2)}</Text></View>; }
function inspectorFor(value: LabRuntime): OperationInspector { return new OperationInspector({ list: query => value.store.listInspection(query), get: key => value.store.get(key), readEvents: (key, page) => value.store.readEvents(key, page) }); }
function formatTime(value: number): string { return new Date(value).toLocaleTimeString(); }
async function bootstrap(): Promise<LabRuntime> {
  const database = await SQLite.openDatabaseAsync('mor-reliability-lab.db'); const store = new AsyncSQLiteOperationStore(database, { wallNow: () => Date.now() }, limits); const opened = await store.open(1); if (opened.kind === 'ERROR') throw new Error(opened.error.code);
  await database.execAsync('CREATE TABLE IF NOT EXISTS lab_e2e_cases (id TEXT PRIMARY KEY NOT NULL) STRICT;');
  const network = await ExpoNetworkHint.open(); let sequence = 0; const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`; const transport = createLabTransport({ baseUrl: fixtureUrl });
  const engine = new OperationEngine({ storage: store, transport, clock: { wallNow: () => Date.now() }, limits, leaseDurationMs: 30_000, identifiers: { ownerId: `expo-lab-${runId}`, nextMutationId: () => `m-${runId}-${++sequence}`, nextAttemptId: () => `a-${runId}-${sequence}` }, isDefinitionReady: () => true, areCredentialsReady: () => true, isVerifierAvailable: () => true, nextJitterSample: () => 0.5, network });
  const scheduler = new OperationScheduler(engine, scenario, { scheduleWake: () => () => {} }, network); const stop = connectLifecycle(scheduler); return { engine, scheduler, store, database, close: () => { stop(); network.close(); } };
}
async function caseIds(database: SQLite.SQLiteDatabase): Promise<readonly OperationId[]> { return (await database.getAllAsync<{ id: string }>('SELECT id FROM lab_e2e_cases ORDER BY id DESC', [])).map(row => operationId(row.id)); }
async function selectFixtureMode(mode: FixtureMode): Promise<void> { const response = await fetch(`${fixtureUrl.replace(/\/$/, '')}/admin/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) }); if (!response.ok) throw new Error(`Fixture mode rejected with HTTP ${response.status}`); }
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#07111f' }, content: { padding: 20, gap: 14 }, hero: { gap: 7, paddingTop: 16, paddingBottom: 10 }, eyebrow: { color: '#7dd3fc', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 }, title: { color: '#f8fafc', fontSize: 31, fontWeight: '800' }, subtitle: { color: '#a8b5c8', fontSize: 15, lineHeight: 22 }, healthCard: { alignItems: 'center', backgroundColor: '#0e2035', borderColor: '#1c3857', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 14 }, healthCopy: { flex: 1 }, healthDot: { backgroundColor: '#34d399', borderRadius: 5, height: 10, width: 10 }, healthTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: '700' }, healthText: { color: '#94a3b8', fontSize: 12, marginTop: 2 }, notice: { color: '#a8b5c8', fontSize: 13, lineHeight: 19 }, section: { gap: 9, paddingTop: 14 }, sectionTitle: { color: '#f1f5f9', fontSize: 18, fontWeight: '700' }, sectionDescription: { color: '#94a3b8', fontSize: 13, lineHeight: 18 }, action: { alignItems: 'center', backgroundColor: '#13263e', borderColor: '#24415f', borderRadius: 13, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 14 }, actionPrimary: { borderColor: '#0ea5e9' }, actionSecondary: { borderColor: '#38bdf8' }, actionWarning: { borderColor: '#f59e0b' }, actionNeutral: {}, actionTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700' }, actionDetail: { color: '#9db1c9', fontSize: 12, marginTop: 3 }, actionArrow: { color: '#7dd3fc', fontSize: 28, fontWeight: '300' }, disabled: { opacity: 0.45 }, pressed: { opacity: 0.7 }, listHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: 16 }, count: { backgroundColor: '#1d3652', borderRadius: 12, color: '#bae6fd', fontSize: 12, fontWeight: '700', overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 3 }, empty: { backgroundColor: '#0e2035', borderColor: '#1c3857', borderRadius: 13, borderWidth: 1, gap: 5, padding: 16 }, emptyTitle: { color: '#dbeafe', fontSize: 15, fontWeight: '700' }, emptyText: { color: '#94a3b8', fontSize: 13, lineHeight: 19 }, operationCard: { backgroundColor: '#0e2035', borderColor: '#1c3857', borderRadius: 13, borderWidth: 1, gap: 8, padding: 14 }, statusPill: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 }, statusText: { color: '#07111f', fontSize: 11, fontWeight: '800' }, accepted: { backgroundColor: '#a5b4fc' }, executing: { backgroundColor: '#7dd3fc' }, unknown: { backgroundColor: '#fbbf24' }, verifying: { backgroundColor: '#c4b5fd' }, completed: { backgroundColor: '#6ee7b7' }, failed: { backgroundColor: '#fda4af' }, operationId: { color: '#dbeafe', fontFamily: 'monospace', fontSize: 13 }, eventText: { color: '#94a3b8', fontSize: 12 }, detailPanel: { backgroundColor: '#0b1a2c', borderColor: '#38bdf8', borderRadius: 13, borderWidth: 1, gap: 9, marginTop: 8, padding: 14 }, detailHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' }, detailTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: '800' }, detailMeta: { color: '#9db1c9', fontSize: 12, lineHeight: 18 }, close: { color: '#7dd3fc', fontSize: 13, fontWeight: '700' }, detailSection: { color: '#dbeafe', fontSize: 13, fontWeight: '700', marginTop: 7 }, eventRow: { flexDirection: 'row', gap: 10 }, eventTime: { color: '#7dd3fc', fontFamily: 'monospace', fontSize: 11, paddingTop: 1 }, eventCopy: { flex: 1 }, eventTransition: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' }, payload: { backgroundColor: '#07111f', borderRadius: 8, color: '#dbeafe', fontFamily: 'monospace', fontSize: 11, lineHeight: 16, padding: 10 }, footer: { color: '#58708c', fontSize: 11, lineHeight: 16, paddingVertical: 10 },
});
