import { createReliabilityFixture } from './src/server.mjs';
const fixture = createReliabilityFixture();
fixture.setMode(process.env.FIXTURE_MODE ?? 'normal');
const host = process.env.HOST ?? '127.0.0.1';
const port = await new Promise(resolve => fixture.server.listen(Number(process.env.PORT ?? 3000), host, () => resolve(fixture.server.address().port)));
console.log(`Reliability fixture listening at http://${host}:${port}`);
process.on('SIGINT', () => { void fixture.close().then(() => process.exit(0)); });
