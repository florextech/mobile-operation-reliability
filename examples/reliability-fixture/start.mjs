import { createReliabilityFixture } from './src/server.mjs';
const fixture = createReliabilityFixture();
const port = await fixture.listen();
console.log(`Reliability fixture listening at http://0.0.0.0:${port}`);
process.on('SIGINT', () => { void fixture.close().then(() => process.exit(0)); });
