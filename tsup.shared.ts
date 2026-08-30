import { readFileSync } from 'node:fs';
import { buildCliHeapBannerPrelude } from './src/cli/heap.js';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export const define = { __MEMORIX_VERSION__: JSON.stringify(pkg.version) };

export const cliBanner = [
  // serve / index keep a large heap; hook uses a small default (see src/cli/heap.ts).
  buildCliHeapBannerPrelude(),
  'import {createRequire as __memorix_cjsRequire} from "module";',
  'const require = __memorix_cjsRequire(import.meta.url);',
].join('\n');

export const cliExternal = [
  'fastembed',
  '@huggingface/transformers',
  'better-sqlite3',
  'ink',
  'react',
  'react/jsx-runtime',
  'yoga-wasm-web',
  '@silvia-odwyer/photon-node',
  '@memorix/memcode',
  '@modelcontextprotocol/server',
  '@modelcontextprotocol/server/stdio',
  '@modelcontextprotocol/node',
];

export const cliNoExternal = [
  /^(?!(fastembed|@huggingface\/transformers|better-sqlite3|ink|react|yoga-wasm-web|@silvia-odwyer\/photon-node|@memorix\/memcode|@modelcontextprotocol\/(server|node)))/,
];
