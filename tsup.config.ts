import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node20',
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    shims: true,
    external: ['fastembed', '@huggingface/transformers'],
  },
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    target: 'node20',
    dts: true,
    sourcemap: true,
    splitting: false,
    shims: true,
    banner: { js: '#!/usr/bin/env node' },
    // Bundle all dependencies into CLI for portable global install
    noExternal: [/^(?!(fastembed|@huggingface\/transformers))/],
    external: ['fastembed', '@huggingface/transformers'],
    // Copy dashboard static files after CLI build
    onSuccess: 'node scripts/copy-static.cjs',
  },
]);

