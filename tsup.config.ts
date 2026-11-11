import { defineConfig } from 'tsup';
import runtimeConfig from './tsup.runtime.config.js';
import cliConfig from './tsup.cli.config.js';
import memcodeConfig from './tsup.memcode.config.js';

// Keep `tsup --watch` and ad-hoc tooling compatible with the aggregate config.
// Release builds use the sequential scripts in package.json so three large
// esbuild graphs do not compete for host memory.
export default defineConfig([runtimeConfig, cliConfig, memcodeConfig]);
