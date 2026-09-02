import { defineConfig } from 'tsup';
import { define } from './tsup.shared.js';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    types: 'src/types.ts',
    sdk: 'src/sdk.ts',
    'maintenance-runner': 'src/runtime/maintenance-runner.ts',
    'vector-backfill-runner': 'src/runtime/vector-backfill-runner.ts',
    'media-video-runner': 'src/runtime/media-video-runner.ts',
    'media-audio-runner': 'src/runtime/media-audio-runner.ts',
  },
  format: ['esm'],
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: false,
  splitting: false,
  shims: true,
  define,
  external: ['fastembed', '@huggingface/transformers', 'better-sqlite3', 'typescript'],
});
