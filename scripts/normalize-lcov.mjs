import { readFileSync, writeFileSync } from 'node:fs';

for (const name of ['core', 'storage-sqlite']) {
  const path = `packages/${name}/coverage/lcov.info`;
  const lcov = readFileSync(path, 'utf8');
  writeFileSync(path, lcov.replaceAll(/^SF:src\//gm, `SF:packages/${name}/src/`));
}
