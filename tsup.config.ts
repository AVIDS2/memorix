import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const define = { __MEMORIX_VERSION__: JSON.stringify(pkg.version) };

export default defineConfig([
  {
    // Phase 4b: types entry added for memorix/types SDK subpath export
    // SDK entry added for memorix/sdk programmatic API
    entry: { index: 'src/index.ts', types: 'src/types.ts', sdk: 'src/sdk.ts' },
    format: ['esm'],
    target: 'node20',
    dts: true,
    sourcemap: true,
    // NO clean here — tsup runs configs in Promise.all (parallel).
    // clean:true would delete dist/ while the CLI config is concurrently writing to it,
    // causing EPERM on Windows (file locked by concurrent writer).
    // Clean is handled by the "build" script in package.json before tsup starts.
    splitting: false,
    shims: true,
    define,
    external: ['fastembed', '@huggingface/transformers', 'better-sqlite3'],
  },
  {
    entry: { 'cli/index': 'src/cli/index.ts', 'cli/memcode': 'src/cli/memcode.ts' },
    format: ['esm'],
    target: 'node20',
    dts: true,
    sourcemap: true,
    splitting: false,
    shims: true,
    define,
    banner: {
      js: [
        '#!/usr/bin/env node',
        // Ensure Node has enough heap for embedding models + Orama index.
        // Re-exec with --max-old-space-size=4096 if not already set.
        'import {spawnSync as __ms} from "node:child_process";',
        'import {fileURLToPath as __fu} from "node:url";',
        'if(!process.env.__MEMORIX_HEAP){process.env.__MEMORIX_HEAP="1";',
        'let r=__ms(process.execPath,["--max-old-space-size=4096",__fu(import.meta.url),...process.argv.slice(2)],{stdio:"inherit",env:process.env});',
        'process.exit(r.status??1);}',
        'import {createRequire as __memorix_cjsRequire} from "module";',
        'const require = __memorix_cjsRequire(import.meta.url);',
      ].join('\n'),
    },
    // Bundle all dependencies into CLI for portable global install
    // ink/react externalized: they have WASM yoga-layout that can't be inlined
    // photon-node externalized: WASM native module can't be bundled by esbuild
    // @memorix/memcode externalized: has OpenTUI native deps that can't be bundled
    noExternal: [/^(?!(fastembed|@huggingface\/transformers|better-sqlite3|ink|react|yoga-wasm-web|@silvia-odwyer\/photon-node|@memorix\/memcode))/],
    external: ['fastembed', '@huggingface/transformers', 'better-sqlite3', 'ink', 'react', 'react/jsx-runtime', 'yoga-wasm-web', '@silvia-odwyer/photon-node', '@memorix/memcode'],
    esbuildOptions(options) {
      options.jsx = 'automatic';
    },
    // Copy dashboard and bundled memcode runtime assets after CLI build.
    onSuccess: 'node scripts/copy-static.cjs && node scripts/copy-memcode-runtime.cjs',
  },
  {
    entry: ['packages/memcode/src/index.ts'],
    format: ['esm'],
    target: 'node22',
    dts: true,
    clean: false,
    outDir: 'dist/memcode',
    sourcemap: true,
    splitting: false,
    shims: true,
    define,
    tsconfig: 'packages/memcode/tsconfig.build.json',
    banner: {
      js: [
        'import {createRequire as __memorix_memcode_cjsRequire} from "module";',
        'const require = __memorix_memcode_cjsRequire(import.meta.url);',
      ].join('\n'),
    },
    external: ['fastembed', '@huggingface/transformers', 'better-sqlite3', './tui/*', '../tui/*'],
    esbuildOptions(options) {
      // Don't bundle the TUI directory — it's loaded lazily via dynamic import
      options.external = options.external || [];
      options.external.push('./tui/*', '../tui/*', 'packages/memcode/src/tui/*');
    },
  },
]);

