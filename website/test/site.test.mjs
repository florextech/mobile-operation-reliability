import assert from 'node:assert/strict';
import test from 'node:test';

import config from '../docusaurus.config.mjs';
import sidebars from '../sidebars.mjs';

test('documentation site uses an explicit local URL and root base path', () => {
  assert.equal(config.url, 'http://localhost:3000');
  assert.equal(config.baseUrl, '/');
});

test('documentation sidebar exposes the public integration path', () => {
  assert.deepEqual(sidebars.docs, ['intro', 'integration', 'backend-contract', 'reliability', 'public-api', 'expo']);
});
