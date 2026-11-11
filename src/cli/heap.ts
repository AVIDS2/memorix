/**
 * CLI heap selection for the tsup respawn banner.
 *
 * `memorix serve` and other long-lived commands need a large V8 heap for
 * embeddings and the in-memory index. `memorix hook` is a per-event
 * lifecycle process and must not reserve a 4 GB heap — copies accumulate.
 */

export const DEFAULT_CLI_HEAP_MB = 4096;
export const DEFAULT_HOOK_HEAP_MB = 512;
export const MIN_HEAP_MB = 64;
export const MAX_HEAP_MB = 16_384;

function parseHeapMb(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const mb = Math.floor(parsed);
  if (mb < MIN_HEAP_MB || mb > MAX_HEAP_MB) return fallback;
  return mb;
}

/**
 * True when the CLI argv selects the short-lived `hook` command.
 * `hooks` (install/status) is a different command and keeps the large heap.
 */
export function isHookCliInvocation(argv: string[]): boolean {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') break;
    if (argument.startsWith('-')) {
      if (!argument.includes('=') && argv[index + 1] && !argv[index + 1].startsWith('-')) {
        index += 1;
      }
      continue;
    }
    return argument === 'hook';
  }
  return false;
}

export function resolveCliHeapMb(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (isHookCliInvocation(argv)) {
    return parseHeapMb(env.MEMORIX_HOOK_HEAP_MB, DEFAULT_HOOK_HEAP_MB);
  }
  return parseHeapMb(env.MEMORIX_HEAP_MB, DEFAULT_CLI_HEAP_MB);
}

/**
 * Self-contained JS prepended to the bundled CLI. It runs before the bundle
 * loads, so the selection logic is inlined rather than imported.
 */
export function buildCliHeapBannerPrelude(): string {
  return [
    '#!/usr/bin/env node',
    'import {spawnSync as __ms} from "node:child_process";',
    'import {fileURLToPath as __fu} from "node:url";',
    'if(!process.env.__MEMORIX_HEAP){process.env.__MEMORIX_HEAP="1";',
    'const __args=process.argv.slice(2);',
    'let __cmd;',
    'for(let __i=0;__i<__args.length;__i++){',
    'const __a=__args[__i];',
    'if(__a==="--")break;',
    'if(__a.startsWith("-")){if(!__a.includes("=")&&__args[__i+1]&&!__args[__i+1].startsWith("-"))__i++;continue;}',
    '__cmd=__a;break;}',
    `const __fallback=__cmd==="hook"?${DEFAULT_HOOK_HEAP_MB}:${DEFAULT_CLI_HEAP_MB};`,
    'const __raw=__cmd==="hook"?process.env.MEMORIX_HOOK_HEAP_MB:process.env.MEMORIX_HEAP_MB;',
    'const __n=Number(__raw);',
    `const __heap=(Number.isFinite(__n)&&__n>=${MIN_HEAP_MB}&&__n<=${MAX_HEAP_MB})?String(Math.floor(__n)):String(__fallback);`,
    'let r=__ms(process.execPath,["--max-old-space-size="+__heap,__fu(import.meta.url),...process.argv.slice(2)],{stdio:"inherit",env:process.env,windowsHide:true});',
    'process.exit(r.status??1);}',
  ].join('\n');
}
