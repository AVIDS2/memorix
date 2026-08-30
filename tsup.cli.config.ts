import { defineConfig } from 'tsup';
import { cliBanner, cliExternal, cliNoExternal, define } from './tsup.shared.js';

export default defineConfig({
  entry: { 'cli/index': 'src/cli/index.ts', 'cli/memcode': 'src/cli/memcode.ts' },
  format: ['esm'],
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: false,
  splitting: false,
  shims: true,
  define,
  banner: { js: cliBanner },
  // Bundle dependencies into the CLI for a portable global install. Native
  // and lazily-loaded packages stay external for their runtime assets.
  noExternal: cliNoExternal,
  external: cliExternal,
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
  onSuccess: 'node scripts/copy-static.cjs && node scripts/copy-memcode-runtime.cjs',
});
