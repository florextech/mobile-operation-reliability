import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const projectKey = 'mobile-operation-reliability';
// The server is published only on loopback; use its local hostname consistently.
const host = 'http://localhost:9000';
const secretPath = '.sonar/local.json';
mkdirSync('.sonar', { recursive: true, mode: 0o700 });
const secrets = existsSync(secretPath)
  ? JSON.parse(readFileSync(secretPath, 'utf8'))
  : { databasePassword: randomBytes(32).toString('hex'), adminPassword: `${randomBytes(24).toString('base64url')}Aa1!` };
function saveSecrets() {
  writeFileSync(secretPath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  writeFileSync('.sonar/compose.env', `SONAR_DB_PASSWORD=${secrets.databasePassword}\n`, { mode: 0o600 });
}
saveSecrets();
function compose(args) {
  const result = spawnSync('docker', ['compose', '--env-file', '.sonar/compose.env', '-f', 'compose.sonar.yaml', ...args], {
    stdio: 'inherit', env: { ...process.env, SONAR_TOKEN: secrets.token ?? '' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Docker Compose exited with ${result.status}`);
}
async function api(path, data, password = secrets.adminPassword) {
  const response = await fetch(`${host}/api/${path}`, {
    method: data ? 'POST' : 'GET',
    headers: { Authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}` },
    ...(data ? { body: new URLSearchParams(data) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Sonar API ${path}: ${response.status} ${await response.text()}`);
  const body = await response.text();
  return body ? JSON.parse(body) : {};
}
async function waitForServer() {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const response = await fetch(`${host}/api/system/status`, { signal: AbortSignal.timeout(3000) });
      if ((await response.json()).status === 'UP') return;
    } catch { /* Server startup may close the connection while components initialize. */ }
    await delay(2000);
  }
  throw new Error('SonarQube did not become UP within five minutes; inspect Docker logs.');
}
async function configure() {
  const validation = await api('authentication/validate');
  if (!validation.valid) await api('users/change_password', { login: 'admin', previousPassword: 'admin', password: secrets.adminPassword }, 'admin');
  const projects = await api(`projects/search?projects=${projectKey}`);
  if (projects.components.length === 0) await api('projects/create', { project: projectKey, name: 'Mobile Operation Reliability', visibility: 'private' });
  await configureGate();
  if (!secrets.token) {
    const generated = await api('user_tokens/generate', { name: `mor-local-${randomBytes(6).toString('hex')}`, type: 'PROJECT_ANALYSIS_TOKEN', projectKey });
    secrets.token = generated.token;
    saveSecrets();
  }
}
async function configureGate() {
  const gateName = 'Mobile Operation Reliability Strict';
  const gates = await api('qualitygates/list');
  if (!gates.qualitygates.some(gate => gate.name === gateName)) {
    await api('qualitygates/copy', { sourceName: 'Sonar way', name: gateName });
  }
  const gate = await api(`qualitygates/show?name=${encodeURIComponent(gateName)}`);
  const conditions = [
    ['coverage', 'LT', '80'], ['duplicated_lines_density', 'GT', '3'],
    ['bugs', 'GT', '0'], ['vulnerabilities', 'GT', '0'], ['code_smells', 'GT', '0'],
    ['security_hotspots_reviewed', 'LT', '100'],
  ];
  for (const [metric, op, error] of conditions) {
    if (!gate.conditions.some(condition => condition.metric === metric)) {
      await api('qualitygates/create_condition', { gateName, metric, op, error });
    }
  }
  await api('qualitygates/select', { gateName, projectKey });
}
async function status() {
  const gate = await api(`qualitygates/project_status?projectKey=${projectKey}`);
  const measures = await api(`measures/component?component=${projectKey}&metricKeys=coverage,line_coverage,branch_coverage,duplicated_lines_density,bugs,vulnerabilities,code_smells,security_hotspots,security_hotspots_reviewed,reliability_rating,security_rating,sqale_rating`);
  const system = await api('system/status');
  const analyses = await api(`project_analyses/search?project=${projectKey}&ps=1`);
  const report = { serverVersion: system.version, analysis: analyses.analyses[0], projectKey, dashboard: `${host}/dashboard?id=${projectKey}`, qualityGate: gate.projectStatus, measures: measures.component.measures };
  writeFileSync('.sonar/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (gate.projectStatus.status !== 'OK') process.exitCode = 1;
}
try {
  switch (process.argv[2]) {
    case 'up':
      compose(['up', '-d', 'db', 'sonarqube']);
      await waitForServer();
      await configure();
      console.log(`SonarQube ready: ${host}/dashboard?id=${projectKey}`);
      console.log('Local credentials: .sonar/local.json (ignored by Git).');
      break;
    case 'down': compose(['down']); break;
    case 'scan':
      await waitForServer();
      await configure();
      compose(['run', '--rm', 'scanner']);
      await status();
      break;
    case 'status': await status(); break;
    default: throw new Error('Usage: node scripts/sonar.mjs up|down|scan|status');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
