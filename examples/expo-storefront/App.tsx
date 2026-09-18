import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { OperationEngine, OperationScheduler, operationId } from '@florextech/core';
import type { OperationId, OperationStatus } from '@florextech/core';
import { AsyncSQLiteOperationStore } from '@florextech/storage-expo';
import { ExpoNetworkHint, connectLifecycle } from './src/mobile-runtime';
import { createStorefrontTransport } from './src/storefront-transport';

const catalog = [{ sku: 'house-coffee', name: 'Café de la casa', note: '340 g · tostión media', price: 14_000 }, { sku: 'almond-pastry', name: 'Croissant de almendras', note: 'Horneado esta mañana', price: 8_000 }] as const;
const scope = { principalScope: 'demo-customer', targetScope: 'cafe-flores' };
const limits = { maxBytes: 65_536, maxDepth: 32 };
const policy = { execution: { maxAttempts: 3, timeoutMs: 10_000, baseDelayMs: 1_000, maxDelayMs: 10_000 }, verification: { maxAttempts: 3, timeoutMs: 10_000, baseDelayMs: 1_000, maxDelayMs: 10_000 }, replay: { kind: 'NONE' as const } };
const fixtureUrl = process.env.EXPO_PUBLIC_FIXTURE_URL ?? 'http://127.0.0.1:3000';
interface Runtime { readonly engine: OperationEngine; readonly scheduler: OperationScheduler; readonly store: AsyncSQLiteOperationStore; readonly database: SQLite.SQLiteDatabase; readonly close: () => void }
interface OrderRow { readonly id: OperationId; readonly status: OperationStatus | 'MISSING' }

export default function App() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<readonly OrderRow[]>([]);
  const [message, setMessage] = useState('Preparing your secure checkout…');
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => catalog.filter(product => (cart[product.sku] ?? 0) > 0).map(product => ({ sku: product.sku, quantity: cart[product.sku], price: product.price })), [cart]);
  const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const refreshOrders = async (value: Runtime) => {
    const ids = await orderIds(value.database);
    const rows = await Promise.all(ids.map(async id => { const read = await value.store.get({ id, ...scope }); return { id, status: read.kind === 'OK' ? read.value?.status ?? 'MISSING' : 'MISSING' } as OrderRow; }));
    setOrders(rows);
  };
  useEffect(() => { let active: Runtime | null = null; void bootstrap().then(async value => { active = value; setRuntime(value); await value.scheduler.run(); await refreshOrders(value); setMessage('Your cart is ready. Orders are saved on this device before checkout.'); }).catch(error => setMessage(`Unable to open checkout: ${String(error)}`)); return () => active?.close(); }, []);
  const changeQuantity = (sku: string, change: number) => setCart(current => ({ ...current, [sku]: Math.max(0, (current[sku] ?? 0) + change) }));
  const checkout = async () => {
    if (!runtime || items.length === 0 || busy) return;
    setBusy(true); setMessage('Saving your order securely…');
    try {
      const id = operationId(`order-${Date.now()}`);
      const handle = await runtime.engine.execute({ id, type: 'order.create', definitionVersion: '1', payload: { items: items.map(item => ({ sku: item.sku, quantity: item.quantity })), total, currency: 'COP' }, ...scope, idempotencyKey: id, policySnapshot: policy });
      await runtime.database.runAsync('INSERT OR IGNORE INTO storefront_order_ids(id) VALUES(?)', [handle.id]);
      setCart({}); setMessage('Order received. Confirming it with Café Flores…');
      await runtime.scheduler.run(); await refreshOrders(runtime);
      setMessage('Your order status was updated from durable storage.');
    } catch (error) { setMessage(`We saved no order confirmation: ${String(error)}`); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}><Text style={styles.brand}>CAFÉ FLORES</Text><Text style={styles.location}>Laureles · Medellín</Text><View style={styles.cartBadge}><Text style={styles.cartText}>{quantity} items · {format(total)}</Text></View></View>
    <View style={styles.hero}><Text style={styles.kicker}>MORNING PICKUP</Text><Text style={styles.title}>A calm start,{"\n"}ready when you are.</Text><Text style={styles.subtitle}>Order ahead and we’ll prepare it for pickup.</Text></View>
    <Text style={styles.sectionTitle}>Today’s favorites</Text>
    {catalog.map(product => <View key={product.sku} style={styles.product}><View style={styles.productCopy}><Text style={styles.productName}>{product.name}</Text><Text style={styles.productNote}>{product.note}</Text><Text style={styles.price}>{format(product.price)}</Text></View><View style={styles.stepper}><Pressable accessibilityRole="button" onPress={() => changeQuantity(product.sku, -1)} style={styles.step}><Text style={styles.stepText}>−</Text></Pressable><Text style={styles.quantity}>{cart[product.sku] ?? 0}</Text><Pressable accessibilityRole="button" onPress={() => changeQuantity(product.sku, 1)} style={styles.step}><Text style={styles.stepText}>+</Text></Pressable></View></View>)}
    <View style={styles.checkout}><Text style={styles.checkoutLabel}>PICKUP · 15–20 MIN</Text><Text style={styles.total}>{format(total)}</Text><Pressable accessibilityRole="button" disabled={!runtime || busy || items.length === 0} onPress={() => void checkout()} style={[styles.checkoutButton, (!runtime || busy || items.length === 0) ? styles.disabled : null]}><Text style={styles.checkoutText}>{busy ? 'Processing order…' : 'Place pickup order'}</Text>{busy ? <ActivityIndicator color="#fff7ed" /> : <Text style={styles.arrow}>→</Text>}</Pressable><Text style={styles.reliability}>{message}</Text></View>
    <View style={styles.ordersHeader}><Text style={styles.sectionTitle}>Your recent orders</Text><Text style={styles.ordersCount}>{orders.length}</Text></View>
    {orders.length === 0 ? <Text style={styles.empty}>Your confirmed pickup orders will appear here, even after restarting the app.</Text> : orders.map(order => <View key={order.id} style={styles.order}><View><Text style={styles.orderLabel}>Pickup order</Text><Text style={styles.orderId}>{order.id}</Text></View><Status status={order.status} /></View>)}
    <Text style={styles.footer}>Checkout operations are stored durably before contacting the order API.</Text>
  </ScrollView></SafeAreaView>;
}
function Status({ status }: { readonly status: OrderRow['status'] }) { const tone = status === 'COMPLETED' ? styles.completed : status === 'UNKNOWN' ? styles.unknown : styles.pending; const label = status === 'COMPLETED' ? 'Confirmed' : status === 'UNKNOWN' ? 'Checking order' : status === 'MISSING' ? 'Unavailable' : 'Processing'; return <View style={[styles.status, tone]}><Text style={styles.statusText}>{label}</Text></View>; }
async function bootstrap(): Promise<Runtime> {
  const database = await SQLite.openDatabaseAsync('cafe-flores-storefront.db'); const store = new AsyncSQLiteOperationStore(database, { wallNow: () => Date.now() }, limits); const opened = await store.open(1); if (opened.kind === 'ERROR') throw new Error(opened.error.code);
  await database.execAsync('CREATE TABLE IF NOT EXISTS storefront_order_ids (id TEXT PRIMARY KEY NOT NULL) STRICT;');
  const network = await ExpoNetworkHint.open(); let sequence = 0; const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const engine = new OperationEngine({ storage: store, transport: createStorefrontTransport(fixtureUrl), clock: { wallNow: () => Date.now() }, limits, leaseDurationMs: 30_000, identifiers: { ownerId: `storefront-${runId}`, nextMutationId: () => `m-${runId}-${++sequence}`, nextAttemptId: () => `a-${runId}-${sequence}` }, isDefinitionReady: () => true, areCredentialsReady: () => true, isVerifierAvailable: () => true, nextJitterSample: () => 0.5, network });
  const scheduler = new OperationScheduler(engine, scope, { scheduleWake: () => () => {} }, network); const stop = connectLifecycle(scheduler); return { engine, scheduler, store, database, close: () => { stop(); network.close(); } };
}
async function orderIds(database: SQLite.SQLiteDatabase): Promise<readonly OperationId[]> { return (await database.getAllAsync<{ id: string }>('SELECT id FROM storefront_order_ids ORDER BY id DESC', [])).map(row => operationId(row.id)); }
function format(value: number): string { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value); }
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fffaf4' }, content: { gap: 16, padding: 20 }, header: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between', paddingTop: 10 }, brand: { color: '#4b2e20', fontSize: 15, fontWeight: '800', letterSpacing: 1.4 }, location: { color: '#8a6555', fontSize: 12 }, cartBadge: { backgroundColor: '#f2e1d3', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 }, cartText: { color: '#633d2a', fontSize: 12, fontWeight: '700' }, hero: { backgroundColor: '#5c3424', borderRadius: 22, gap: 9, padding: 24 }, kicker: { color: '#fed7aa', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 }, title: { color: '#fff7ed', fontSize: 31, fontWeight: '800', lineHeight: 37 }, subtitle: { color: '#fed7aa', fontSize: 15, lineHeight: 21 }, sectionTitle: { color: '#4b2e20', fontSize: 20, fontWeight: '800', marginTop: 4 }, product: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#f1dfd3', borderRadius: 16, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 16 }, productCopy: { flex: 1, gap: 4 }, productName: { color: '#3f291f', fontSize: 16, fontWeight: '800' }, productNote: { color: '#8a6555', fontSize: 13 }, price: { color: '#b45309', fontSize: 14, fontWeight: '800', marginTop: 3 }, stepper: { alignItems: 'center', flexDirection: 'row', gap: 12 }, step: { alignItems: 'center', backgroundColor: '#f9eee6', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 }, stepText: { color: '#663b28', fontSize: 22, fontWeight: '700' }, quantity: { color: '#4b2e20', fontSize: 16, fontWeight: '800', minWidth: 12, textAlign: 'center' }, checkout: { backgroundColor: '#fff', borderColor: '#f1dfd3', borderRadius: 18, borderWidth: 1, gap: 10, padding: 18 }, checkoutLabel: { color: '#9a5b32', fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }, total: { color: '#3f291f', fontSize: 28, fontWeight: '800' }, checkoutButton: { alignItems: 'center', backgroundColor: '#c65d27', borderRadius: 13, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 15 }, checkoutText: { color: '#fff7ed', fontSize: 16, fontWeight: '800' }, arrow: { color: '#fff7ed', fontSize: 23 }, disabled: { opacity: 0.45 }, reliability: { color: '#8a6555', fontSize: 12, lineHeight: 18 }, ordersHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }, ordersCount: { backgroundColor: '#f2e1d3', borderRadius: 12, color: '#633d2a', fontSize: 12, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3 }, empty: { color: '#8a6555', fontSize: 13, lineHeight: 19, paddingBottom: 8 }, order: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#f1dfd3', borderRadius: 14, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 14 }, orderLabel: { color: '#4b2e20', fontSize: 14, fontWeight: '800' }, orderId: { color: '#8a6555', fontFamily: 'monospace', fontSize: 11, marginTop: 3 }, status: { borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5 }, completed: { backgroundColor: '#bbf7d0' }, unknown: { backgroundColor: '#fde68a' }, pending: { backgroundColor: '#dbeafe' }, statusText: { color: '#3f291f', fontSize: 11, fontWeight: '800' }, footer: { color: '#a27a68', fontSize: 11, lineHeight: 16, paddingVertical: 12, textAlign: 'center' },
});
