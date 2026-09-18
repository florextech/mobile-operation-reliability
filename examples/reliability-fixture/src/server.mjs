import { createServer } from 'node:http';

/** Local idempotent fixture used only by the Expo reliability laboratory. */
export function createReliabilityFixture() {
  const payments = new Map();
  let mode = 'normal';
  const server = createServer(async (request, response) => {
    const body = await readJson(request).catch(() => null);
    if (request.method === 'POST' && request.url === '/payments' && body?.idempotencyKey) {
      if (mode === '503') return respond(response, 503, { code: 'TEMPORARY' });
      if (mode === '429') return respond(response, 429, { code: 'RATE_LIMITED' }, { 'retry-after': '1' });
      const payment = payments.get(body.idempotencyKey) ?? Object.freeze({ id: `payment-${payments.size + 1}`, operationId: body.operationId, amount: body.amount });
      payments.set(body.idempotencyKey, payment);
      if (mode === 'drop-after-apply') { mode = 'normal'; return response.destroy(); }
      return respond(response, 200, payment);
    }
    if (request.method === 'POST' && request.url === '/admin/mode' && isMode(body?.mode)) {
      mode = body.mode;
      return respond(response, 200, { mode });
    }
    if (request.method === 'GET' && request.url?.startsWith('/payments/')) {
      const key = decodeURIComponent(request.url.slice('/payments/'.length));
      const payment = payments.get(key);
      return payment ? respond(response, 200, payment) : respond(response, 404, { code: 'NOT_FOUND' });
    }
    respond(response, 404, { code: 'NOT_FOUND' });
  });
  return Object.freeze({
    server,
    setMode(next) { if (!isMode(next)) throw new Error('Invalid fixture mode'); mode = next; },
    listen() { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); },
    close() { return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
    count() { return payments.size; },
  });
}
function isMode(value) { return value === 'normal' || value === '429' || value === '503' || value === 'drop-after-apply'; }
function respond(response, status, value, headers = {}) { response.writeHead(status, { 'content-type': 'application/json', ...headers }); response.end(JSON.stringify(value)); }
function readJson(request) { return new Promise((resolve, reject) => { let text = ''; request.on('data', chunk => { text += chunk; }); request.on('end', () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } }); request.on('error', reject); }); }
