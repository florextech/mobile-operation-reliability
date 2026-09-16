import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const image = 'semgrep/semgrep@sha256:34ab619bf1391a24bfda3f05debd0d8a6ce3093c2d5f9d39cfc00f83c1397823';
const targets = readdirSync('packages', { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(`packages/${entry.name}/src`))
  .map(entry => `packages/${entry.name}/src`);
targets.push('scripts');
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:[cm]?js|tsx?)$/.test(entry.name) ? [path] : [];
  });
}
const expected = targets.flatMap(sourceFiles);
if (expected.length === 0) throw new Error('No source files found; refusing an empty security scan.');
mkdirSync('.security', { recursive: true });
rmSync('.security/semgrep.json', { force: true });
const args = ['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,size=512m',
  '-e', 'HOME=/tmp/semgrep', '-e', 'SEMGREP_SEND_METRICS=off', '-e', 'SEMGREP_ENABLE_VERSION_CHECK=0',
  '-v', `${resolve('.semgrep')}:/rules:ro`, '-v', `${resolve('.security')}:/reports`, '-w', '/src'];
for (const target of targets) args.push('-v', `${resolve(target)}:/src/${target}:ro`);
args.push(image, 'semgrep', 'scan', '--oss-only', '--config', '/rules/typescript.yaml',
  '--metrics', 'off', '--disable-version-check', '--no-git-ignore', '--disable-nosem',
  '--error', '--strict', '--max-target-bytes', '0', '--json', '--output', '/reports/semgrep.json', ...targets);
const result = spawnSync('docker', args, { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) {
  console.error(`Semgrep failed (exit ${result.status}); inspect .security/semgrep.json.`);
  process.exit(result.status ?? 1);
}
const report = JSON.parse(readFileSync('.security/semgrep.json', 'utf8'));
const scanned = new Set(report.paths?.scanned);
const missing = expected.filter(path => !scanned.has(path));
if (report.errors?.length || report.results?.length || missing.length) {
  console.error('Semgrep gate failed:', { errors: report.errors?.length, findings: report.results?.length, missing });
  process.exit(1);
}
console.log(`Semgrep CE: ${scanned.size} files scanned, zero findings, zero errors. Report: .security/semgrep.json`);
