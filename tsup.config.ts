import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const define = { __MEMORIX_VERSION__: JSON.stringify(pkg.version) };

export default defineConfig([
  {
    // Phase 4b: types entry added for memorix/types SDK subpath export
    entry: { index: 'src/index.ts', types: 'src/types.ts' },
    format: ['esm'],
    target: 'node20',
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    shims: true,
    define,
    external: ['fastembed', '@huggingface/transformers', 'better-sqlite3'],
  },
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
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
        'import {createRequire as __memorix_cjsRequire} from "module";',
        'const require = __memorix_cjsRequire(import.meta.url);',
      ].join('\n'),
    },
    // Bundle all dependencies into CLI for portable global install
    // ink/react externalized: they have WASM yoga-layout that can't be inlined
    noExternal: [/^(?!(fastembed|@huggingface\/transformers|better-sqlite3|ink|react|yoga-wasm-web))/],
    external: ['fastembed', '@huggingface/transformers', 'better-sqlite3', 'ink', 'react', 'react/jsx-runtime', 'yoga-wasm-web'],
    esbuildOptions(options) {
      options.jsx = 'automatic';
    },
    // Copy dashboard static files after CLI build
    onSuccess: 'node scripts/copy-static.cjs',
  },
]);

