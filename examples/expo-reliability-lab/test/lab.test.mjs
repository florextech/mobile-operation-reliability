import test from 'node:test';
import assert from 'node:assert/strict';
test('lab package stays private and consumes workspace packages', async () => { const manifest = await import('../package.json', { with: { type: 'json' } }); assert.equal(manifest.default.private, true); assert.equal(manifest.default.dependencies['@florexlabs/mor'], 'workspace:*'); });
