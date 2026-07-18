#!/usr/bin/env node

/*
 * Reproducible local provider measurement. It intentionally invokes the
 * packaged CLI in a target project so Lite refresh and optional semantic
 * CodeGraph enrichment follow the same public path as users.
 */
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'dist', 'cli', 'index.js');

function usage() {
  console.error('Usage: node scripts/benchmark-codegraph-provider.cjs --path <git-project> --task <task text>');
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        // The benchmark measures code providers, not an embedding download.
        MEMORIX_EMBEDDING: process.env.MEMORIX_EMBEDDING ?? 'off',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      const elapsedMs = Math.round(performance.now() - started);
      if (code !== 0) {
        reject(new Error(`memorix ${args.join(' ')} exited ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      try {
        resolve({ elapsedMs, value: JSON.parse(stdout) });
      } catch (error) {
        reject(new Error(`memorix returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

async function main() {
  const target = option('--path');
  const task = option('--task');
  if (!target || !task) {
    usage();
    process.exitCode = 2;
    return;
  }
  const projectRoot = path.resolve(target);
  if (!existsSync(projectRoot)) throw new Error(`Project path does not exist: ${projectRoot}`);
  if (!existsSync(cli)) throw new Error('Missing dist/cli/index.js. Run npm run build first.');

  const refresh = await run(['codegraph', 'refresh', '--json'], projectRoot);
  const context = await run(['context', '--task', task, '--refresh', 'never', '--json'], projectRoot);
  const quality = context.value.providerQuality ?? context.value.workset?.provenance?.codeProvider;
  const semantic = context.value.workset?.semanticCode;

  console.log(JSON.stringify({
    projectRoot,
    task,
    liteRefresh: {
      elapsedMs: refresh.elapsedMs,
      files: refresh.value.status?.files ?? 0,
      symbols: refresh.value.status?.symbols ?? 0,
      edges: refresh.value.status?.edges ?? 0,
      completeness: refresh.value.status?.latestSnapshot?.completeness,
    },
    taskContext: {
      elapsedMs: context.elapsedMs,
      provider: quality?.selected ?? 'lite',
      quality: quality?.selectedQuality ?? 'heuristic',
      externalState: quality?.external?.state ?? 'not-reported',
      semanticEntryPoints: semantic?.entryPoints?.length ?? 0,
      semanticRelations: semantic?.relations?.length ?? 0,
      promptTokens: context.value.workset?.budget?.tokenCount ?? 0,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
