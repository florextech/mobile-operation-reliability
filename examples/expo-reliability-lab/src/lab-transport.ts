import type { ExecutionResult, TransportContext, TransportPort, VerificationResult } from '@florextech/core';

export interface LabTransportOptions { readonly baseUrl: string; readonly fetch?: typeof globalThis.fetch; readonly now?: () => number }
/** Maps only the fixture's documented business contract; HTTP alone is not general evidence. */
export function createLabTransport(options: LabTransportOptions): TransportPort {
  const request = options.fetch ?? globalThis.fetch; const now = options.now ?? Date.now; const base = options.baseUrl.replace(/\/$/, '');
  const evidence = (context: TransportContext<'EXECUTING'> | TransportContext<'VERIFYING'>, source: 'BACKEND' | 'LOCAL', scope: 'OPERATION' | 'ATTEMPT', code: string) => ({ operationId: context.operation.id, attemptId: context.attemptId, source, scope, observedAt: now(), code });
  return {
    async execute(context) {
      const amount = paymentAmount(context.operation);
      const response = await request(`${base}/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: context.operation.id, idempotencyKey: context.operation.id, amount }) });
      if (response.status === 200) return { result: { kind: 'CONFIRMED_COMPLETED', evidence: evidence(context, 'BACKEND', 'OPERATION', 'PAYMENT_CREATED'), result: await response.json() } satisfies ExecutionResult };
      if (response.status === 429 || response.status === 503) return { result: { kind: 'NOT_APPLIED', evidence: evidence(context, 'BACKEND', 'ATTEMPT', `HTTP_${response.status}`), retryable: true } satisfies ExecutionResult, ...(retryAfter(response, now) === undefined ? {} : { retryAfterAt: retryAfter(response, now) }) };
      throw new Error(`Unexpected fixture status ${response.status}`);
    },
    async verify(context) {
      const response = await request(`${base}/payments/${encodeURIComponent(context.operation.id)}`);
      if (response.status === 200) return { result: { kind: 'CONFIRMED_COMPLETED', evidence: evidence(context, 'BACKEND', 'OPERATION', 'PAYMENT_VERIFIED'), result: await response.json() } satisfies VerificationResult };
      if (response.status === 404) return { result: { kind: 'FINAL_NOT_APPLIED', evidence: evidence(context, 'BACKEND', 'OPERATION', 'PAYMENT_ABSENT'), retryable: true } satisfies VerificationResult };
      throw new Error(`Unexpected fixture status ${response.status}`);
    },
  };
}
function paymentAmount(operation: TransportContext<'EXECUTING'>['operation']): number {
  const payload = operation.payload;
  if (operation.type !== 'payment.create' || payload === null || Array.isArray(payload) || typeof payload !== 'object') throw new Error('Invalid lab payment payload');
  const amount = (payload as Readonly<Record<string, unknown>>).amount;
  if (typeof amount !== 'number') throw new Error('Invalid lab payment payload');
  return amount;
}
function retryAfter(response: Response, now: () => number): number | undefined { const seconds = Number(response.headers.get('retry-after')); return Number.isFinite(seconds) && seconds >= 0 ? now() + seconds * 1_000 : undefined; }
