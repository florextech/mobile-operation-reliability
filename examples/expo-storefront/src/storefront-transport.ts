import type { ExecutionResult, TransportContext, TransportPort, VerificationResult } from '@florextech/core';

export function createStorefrontTransport(baseUrl: string): TransportPort {
  const base = baseUrl.replace(/\/$/, '');
  const evidence = (context: TransportContext<'EXECUTING'> | TransportContext<'VERIFYING'>, code: string) => ({ operationId: context.operation.id, attemptId: context.attemptId, source: 'BACKEND' as const, scope: 'OPERATION' as const, observedAt: Date.now(), code });
  return {
    async execute(context) {
      const order = orderPayload(context.operation);
      const response = await fetch(`${base}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: context.operation.id, idempotencyKey: context.operation.id, ...order }) });
      if (response.status === 201) return { result: { kind: 'CONFIRMED_COMPLETED', evidence: evidence(context, 'ORDER_CREATED'), result: await response.json() } satisfies ExecutionResult };
      if (response.status >= 500) return { result: { kind: 'NOT_APPLIED', retryable: true, evidence: { ...evidence(context, `HTTP_${response.status}`), scope: 'ATTEMPT' as const } } satisfies ExecutionResult };
      throw new Error(`Unexpected storefront response ${response.status}`);
    },
    async verify(context) {
      const response = await fetch(`${base}/orders/${encodeURIComponent(context.operation.id)}`);
      if (response.status === 200) return { result: { kind: 'CONFIRMED_COMPLETED', evidence: evidence(context, 'ORDER_VERIFIED'), result: await response.json() } satisfies VerificationResult };
      if (response.status === 404) return { result: { kind: 'FINAL_NOT_APPLIED', retryable: true, evidence: evidence(context, 'ORDER_ABSENT') } satisfies VerificationResult };
      throw new Error(`Unexpected order verification response ${response.status}`);
    },
  };
}
function orderPayload(operation: TransportContext<'EXECUTING'>['operation']) {
  const payload = operation.payload;
  if (operation.type !== 'order.create' || payload === null || Array.isArray(payload) || typeof payload !== 'object') throw new Error('Invalid storefront order payload');
  const value = payload as Readonly<Record<string, unknown>>;
  if (!Array.isArray(value.items) || typeof value.total !== 'number' || typeof value.currency !== 'string') throw new Error('Invalid storefront order payload');
  return { items: value.items, total: value.total, currency: value.currency };
}
