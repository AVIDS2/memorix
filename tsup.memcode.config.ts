import { defineConfig } from 'tsup';
import { define } from './tsup.shared.js';

export default defineConfig({
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
    // The TUI directory is loaded lazily and has native dependencies.
    options.external = options.external || [];
    options.external.push('./tui/*', '../tui/*', 'packages/memcode/src/tui/*');
  },
});
