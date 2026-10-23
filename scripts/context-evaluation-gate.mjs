import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: { ...process.env, ...(options.env ?? {}) },
    shell: command.endsWith('.cmd'),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result;
}

// The runtime matrix is a release gate, so its large-store evidence must be
// produced by the same packed build and transport smoke used by the capacity
// gate rather than by a synthetic fixture.
run(npmCommand, ['run', 'build']);
const largeStore = run(process.execPath, ['scripts/large-store-gate.mjs', '--records', '40000'], { capture: true });
const output = String(largeStore.stdout ?? '').trim();
const firstBrace = output.indexOf('{');
const lastBrace = output.lastIndexOf('}');
if (firstBrace < 0 || lastBrace <= firstBrace) {
  console.error('large-store gate did not emit a JSON report');
  process.exit(1);
}
const report = JSON.parse(output.slice(firstBrace, lastBrace + 1));
if (!report.ok) {
  console.error('large-store gate returned a failed report');
  process.exit(1);
}

run(npmCommand, [
  'exec',
  '--',
  'vitest',
  'run',
  'tests/evaluation/context-task-runtime.test.ts',
], {
  env: {
    MEMORIX_CONTEXT_EVAL_RUNTIME: '1',
    MEMORIX_LARGE_STORE_EVIDENCE: JSON.stringify(report),
  },
});
