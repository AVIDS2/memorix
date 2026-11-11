#!/usr/bin/env node

/*
 * Opt-in CodeGraph scale probe. It creates the fixture under an explicitly
 * supplied parent, measures the public CLI path, and removes the fixture.
 * Requiring --tmp-root prevents a large generated corpus from landing on the
 * system drive by accident.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(root, 'dist', 'cli', 'index.js');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positive(name, fallback) {
  const value = Number(option(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function run(args, cwd, extraEnv = {}) {
  return new Promise((resolveRun, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, MEMORIX_EMBEDDING: 'off', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`memorix ${args.join(' ')} exited ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      try {
        resolveRun({ elapsedMs: Math.round(performance.now() - started), value: JSON.parse(stdout) });
      } catch (error) {
        reject(new Error(`memorix returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

async function main() {
  const parent = option('--tmp-root');
  if (!parent) {
    console.error('Usage: node scripts/benchmark-codegraph-scale.mjs --tmp-root E:\\tmp\\memorix-bench [--files 10000] [--symbols-per-file 10]');
    process.exitCode = 2;
    return;
  }
  const parentRoot = resolve(parent);
  const fileCount = positive('--files', 10_000);
  const symbolsPerFile = positive('--symbols-per-file', 10);
  const projectRoot = await mkdtemp(join(parentRoot, 'memorix-codegraph-scale-'));
  const gitConfig = join(projectRoot, '.gitconfig');
  const gitEnv = { GIT_CONFIG_GLOBAL: gitConfig };
  try {
    await writeFile(gitConfig, '', 'utf8');
    await execFile('git', ['init', '--quiet'], { cwd: projectRoot, env: { ...process.env, ...gitEnv }, windowsHide: true });
    await execFile('git', ['config', '--global', '--add', 'safe.directory', projectRoot], { cwd: projectRoot, env: { ...process.env, ...gitEnv }, windowsHide: true });
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    const files = [];
    for (let index = 0; index < fileCount; index += 1) {
      const lines = [`// generated scale fixture ${index}`];
      for (let symbol = 0; symbol < symbolsPerFile; symbol += 1) {
        lines.push(`export function fixture_${index}_${symbol}() { return ${symbol}; }`);
      }
      files.push(writeFile(join(projectRoot, 'src', `fixture-${String(index).padStart(5, '0')}.ts`), `${lines.join('\n')}\n`, 'utf8'));
      if (files.length >= 250) {
        await Promise.all(files.splice(0));
      }
    }
    await Promise.all(files);
    const refresh = await run(['codegraph', 'refresh', '--json', '--max-files', String(fileCount)], projectRoot, gitEnv);
    const status = await run(['codegraph', 'status', '--json'], projectRoot, gitEnv);
    console.log(JSON.stringify({
      projectRoot,
      requestedFiles: fileCount,
      requestedSymbols: fileCount * symbolsPerFile,
      refreshMs: refresh.elapsedMs,
      statusMs: status.elapsedMs,
      status: {
        files: status.value.status?.files ?? 0,
        symbols: status.value.status?.symbols ?? 0,
        semanticSymbols: status.value.status?.semanticSymbols ?? 0,
        semanticEdges: status.value.status?.semanticEdges ?? 0,
        parserErrors: status.value.status?.parserErrors ?? 0,
      },
    }, null, 2));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
