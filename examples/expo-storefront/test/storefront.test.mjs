import test from 'node:test';
import assert from 'node:assert/strict';
test('storefront remains a private reference application using the MOR SDK', async () => { const manifest = await import('../package.json', { with: { type: 'json' } }); assert.equal(manifest.default.private, true); assert.equal(manifest.default.dependencies['@florexlabs/mor'], 'workspace:*'); assert.equal(manifest.default.dependencies['@florexlabs/mor-expo'], 'workspace:*'); assert.equal(manifest.default.dependencies['@florexlabs/mor-inspector'], undefined); });
