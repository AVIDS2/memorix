import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..');
const sourceRoot = join(repoRoot, 'src');
const runtimeExtensions = new Set(['.ts', '.tsx', '.js']);
// Keep terminal box drawing and brand glyphs available, but reject emoji-like
// status marks in runtime/user-facing source.
const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const forbiddenStatusSymbols = new Set(['\u23f0', '\u23f1', '\u23ed']);

function collectRuntimeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRuntimeFiles(fullPath, out);
    } else if (runtimeExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      out.push(fullPath);
    }
  }
  return out;
}

describe('runtime emoji policy', () => {
  it('keeps runtime source output professional and emoji-free', () => {
    const offenders: string[] = [];
    for (const file of collectRuntimeFiles(sourceRoot)) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (emojiPattern.test(line) || [...forbiddenStatusSymbols].some(symbol => line.includes(symbol))) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
