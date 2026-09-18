import { createReliabilityFixture } from './src/server.mjs';
const fixture = createReliabilityFixture();
fixture.setMode(process.env.FIXTURE_MODE ?? 'normal');
const port = await new Promise(resolve => fixture.server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => resolve(fixture.server.address().port)));
console.log(`Reliability fixture listening at http://0.0.0.0:${port}`);
process.on('SIGINT', () => { void fixture.close().then(() => process.exit(0)); });
