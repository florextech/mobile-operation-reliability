import test from 'node:test';
import assert from 'node:assert/strict';
test('storefront remains a private workspace reference application', async () => { const manifest = await import('../package.json', { with: { type: 'json' } }); assert.equal(manifest.default.private, true); assert.equal(manifest.default.dependencies['@florextech/core'], 'workspace:*'); });
