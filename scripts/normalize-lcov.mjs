import { readFileSync, writeFileSync } from 'node:fs';

const path = 'packages/core/coverage/lcov.info';
const lcov = readFileSync(path, 'utf8');
writeFileSync(path, lcov.replaceAll(/^SF:src\//gm, 'SF:packages/core/src/'));
