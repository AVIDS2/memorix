import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installAgentGuidance } from '../../src/hooks/installers/index.js';
import { countTextTokens } from '../../src/compact/token-budget.js';

/**
 * Guidance-content exam: the generated agent guidance must teach the memory
 * hygiene rules this main line ships. Deterministic phrase checks, no model.
 *
 * Eval-first: before the guidance change, none of the required phrases exist
 * (baseline 0/4). After the change, all four must exist while the guidance
 * stays inside its token ceiling.
 */

const REQUIRED_RULES: Array<{ id: string; phrase: string }> = [
  { id: 'underivable', phrase: 'cannot re-derive' },
  { id: 'dual-channel', phrase: 'not only what failed' },
  { id: 'verify-before-use', phrase: 'claim about the past' },
  { id: 'ignore-semantics', phrase: 'proceed as if memory were empty' },
];

const TOKEN_CEILING = 2500;

let sandbox = '';

describe('guidance content exam', () => {
  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), 'memorix-guidance-'));
  });

  afterEach(() => {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    sandbox = '';
  });

  it('project guidance teaches all hygiene rules inside the token ceiling', async () => {
    const rulesPath = await installAgentGuidance('codex', sandbox, false);
    const content = readFileSync(rulesPath, 'utf-8');

    const present = REQUIRED_RULES.filter((rule) => content.includes(rule.phrase));
    const tokens = countTextTokens(content);

    // eslint-disable-next-line no-console
    console.log(
      '\nGuidance scoreboard\n'
      + `  rules present: ${present.map((rule) => rule.id).join(', ') || '(none)'}`
      + ` (${present.length}/${REQUIRED_RULES.length})\n`
      + `  tokens:        ${tokens} (ceiling ${TOKEN_CEILING})`,
    );

    expect(tokens, 'guidance must stay inside its token ceiling').toBeLessThanOrEqual(TOKEN_CEILING);
    expect(present.map((rule) => rule.id)).toEqual(REQUIRED_RULES.map((rule) => rule.id));
  });

  it('global guidance teaches the same hygiene rules', async () => {
    // Global installs target the agent home — dsh honors $DSH_HOME, which
    // keeps the exam isolated without touching the real user home.
    const originalDshHome = process.env.DSH_HOME;
    process.env.DSH_HOME = sandbox;
    try {
      const rulesPath = await installAgentGuidance('dsh', sandbox, true);
      const content = readFileSync(rulesPath, 'utf-8');
      for (const rule of REQUIRED_RULES) {
        expect(content, `missing rule: ${rule.id}`).toContain(rule.phrase);
      }
    } finally {
      if (originalDshHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = originalDshHome;
    }
  });
});
