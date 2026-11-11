# Unified TOML Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Memorix's user-facing split config story with a single TOML-first configuration model while preserving `.git`-based project identity and memcode's inherited agent behavior.

**Architecture:** Add one typed TOML resolver at the root `src/config` layer, make CLI/status/init read from that resolver first, and bridge the resolved `[agent]` lane into memcode bootstrap without replacing memcode's own settings manager. Legacy YAML, dotenv, and JSON readers remain as compatibility inputs behind the new resolver.

**Tech Stack:** TypeScript, Vitest, Node 22, Citty CLI, existing memcode runtime, existing project detector

---

## File Structure

**Create:**
- `src/config/config-paths.ts` — central path resolution for global and project TOML/YAML/legacy config files
- `src/config/toml-loader.ts` — TOML parser/loader with per-project cache
- `src/config/resolved-config.ts` — typed merged config resolver and lane accessors
- `tests/config/toml-loader.test.ts` — TOML loading and precedence tests
- `tests/config/resolved-config.test.ts` — merged lane resolution tests
- `tests/cli/config-command.test.ts` — CLI `config` subcommand coverage
- `packages/memcode/src/config/memorix-config-adapter.ts` — memcode bootstrap adapter from Memorix config to agent runtime defaults
- `packages/memcode/test/memorix-config-adapter.test.ts` — memcode adapter tests

**Modify:**
- `src/config.ts` — delegate getters to TOML-first resolved config
- `src/config.js` — keep JS mirror aligned with `src/config.ts`
- `src/config/yaml-loader.ts` — demote YAML to compatibility input and reuse shared path helpers
- `src/config/dotenv-loader.ts` — compatibility-only loading with shared path helpers
- `src/cli/commands/init.ts` — generate `config.toml` instead of `memorix.yml`
- `src/cli/commands/status.ts` — show TOML-first provenance and lane snapshot
- `src/cli/index.ts` — add `config` command surface
- `packages/memcode/src/cli.ts` — load Memorix resolved config before `main()`
- `packages/memcode/src/core/model-resolver.ts` or `packages/memcode/src/core/model-registry.ts` — consume injected agent defaults if needed
- `README.md`
- `README.zh-CN.md`
- `docs/CONFIGURATION.md`
- `memorix.example.yml` or replacement TOML example file

**Review During Implementation:**
- `src/project/detector.ts` — keep `.git` project identity contract intact
- `tests/config/yaml-project-root.test.ts`
- `tests/config/dotenv-loader.test.ts`
- `tests/config/embedding-api-key-aliases.test.ts`
- `packages/memcode/test/config.test.ts`
- `packages/memcode/test/model-resolver.test.ts`

### Task 1: Add Shared Config Path Resolution

**Files:**
- Create: `src/config/config-paths.ts`
- Modify: `src/config/yaml-loader.ts`
- Modify: `src/config/dotenv-loader.ts`
- Test: `tests/config/toml-loader.test.ts`

- [ ] **Step 1: Write the failing test for global/project TOML path resolution**

```ts
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { getGlobalConfigTomlPath, getProjectConfigTomlPath } from '../../src/config/config-paths.js';

describe('config-paths', () => {
  it('builds the global and project TOML paths deterministically', () => {
    expect(getGlobalConfigTomlPath('C:/Users/Test')).toBe('C:/Users/Test/.memorix/config.toml');
    expect(getProjectConfigTomlPath('E:/repo/demo')).toBe('E:/repo/demo/memorix.toml');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/config/toml-loader.test.ts`
Expected: FAIL with module or export not found for `config-paths.js`

- [ ] **Step 3: Write the minimal path helper implementation**

```ts
import { join } from 'node:path';

export function getGlobalConfigTomlPath(homeDir: string): string {
  return join(homeDir, '.memorix', 'config.toml');
}

export function getProjectConfigTomlPath(projectRoot: string): string {
  return join(projectRoot, 'memorix.toml');
}

export function getGlobalYamlPath(homeDir: string): string {
  return join(homeDir, '.memorix', 'memorix.yml');
}

export function getProjectYamlPath(projectRoot: string): string {
  return join(projectRoot, 'memorix.yml');
}

export function getGlobalDotenvPath(homeDir: string): string {
  return join(homeDir, '.memorix', '.env');
}

export function getProjectDotenvPath(projectRoot: string): string {
  return join(projectRoot, '.env');
}
```

- [ ] **Step 4: Point YAML and dotenv loaders at the shared path helpers**

```ts
import {
  getGlobalDotenvPath,
  getGlobalYamlPath,
  getProjectDotenvPath,
  getProjectYamlPath,
} from './config-paths.js';
```

- [ ] **Step 5: Run tests to verify path helpers pass**

Run: `npm test -- tests/config/toml-loader.test.ts tests/config/dotenv-loader.test.ts tests/config/yaml-project-root.test.ts`
Expected: PASS for new path helper coverage, existing dotenv/yaml tests still green

- [ ] **Step 6: Commit**

```bash
git add src/config/config-paths.ts src/config/yaml-loader.ts src/config/dotenv-loader.ts tests/config/toml-loader.test.ts
git commit -m "refactor: centralize memorix config paths"
```

### Task 2: Add TOML Loader and Typed Resolved Config

**Files:**
- Create: `src/config/toml-loader.ts`
- Create: `src/config/resolved-config.ts`
- Modify: `src/config.ts`
- Modify: `src/config.js`
- Test: `tests/config/toml-loader.test.ts`
- Test: `tests/config/resolved-config.test.ts`

- [ ] **Step 1: Write the failing TOML loader tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTomlConfig, resetTomlConfigCache } from '../../src/config/toml-loader.js';

const TMP = join(process.cwd(), 'tmp-toml-loader');
const HOME = join(TMP, 'home');
const PROJECT = join(TMP, 'project');

describe('loadTomlConfig', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(HOME, '.memorix'), { recursive: true });
    mkdirSync(PROJECT, { recursive: true });
    resetTomlConfigCache();
  });

  it('loads global config.toml', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), '[memory]\ninject = "minimal"\n', 'utf8');
    expect(loadTomlConfig({ projectRoot: null, homeDir: HOME }).memory?.inject).toBe('minimal');
  });

  it('lets project memorix.toml override global config.toml', () => {
    writeFileSync(join(HOME, '.memorix', 'config.toml'), '[memory]\ninject = "silent"\n', 'utf8');
    writeFileSync(join(PROJECT, 'memorix.toml'), '[memory]\ninject = "full"\n', 'utf8');
    expect(loadTomlConfig({ projectRoot: PROJECT, homeDir: HOME }).memory?.inject).toBe('full');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/config/toml-loader.test.ts tests/config/resolved-config.test.ts`
Expected: FAIL because `toml-loader.js` and `resolved-config.js` do not exist yet

- [ ] **Step 3: Add the TOML loader**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { parse as parseToml } from '@iarna/toml';
import { getGlobalConfigTomlPath, getProjectConfigTomlPath } from './config-paths.js';

export interface MemorixTomlConfig {
  agent?: { provider?: string; model?: string; base_url?: string; api_key?: string };
  memory?: {
    inject?: 'full' | 'minimal' | 'silent';
    formation?: 'active' | 'shadow' | 'fallback';
    auto_cleanup?: boolean;
    llm?: { provider?: string; model?: string; base_url?: string; api_key?: string };
  };
  embedding?: { provider?: string; model?: string; base_url?: string; api_key?: string; dimensions?: number };
  hooks?: { native_memcode?: boolean; external_agents?: boolean };
  server?: { transport?: 'stdio' | 'http'; dashboard?: boolean; dashboard_port?: number; port?: number };
}
```

- [ ] **Step 4: Add the merged resolved-config layer**

```ts
export interface ResolvedMemorixConfig {
  agent: { provider?: string; model?: string; baseUrl?: string; apiKey?: string };
  memory: {
    inject?: 'full' | 'minimal' | 'silent';
    formation?: 'active' | 'shadow' | 'fallback';
    autoCleanup?: boolean;
    llm: { provider?: string; model?: string; baseUrl?: string; apiKey?: string };
  };
  embedding: { provider?: string; model?: string; baseUrl?: string; apiKey?: string; dimensions?: number };
  server: { transport?: 'stdio' | 'http'; dashboard?: boolean; dashboardPort?: number; port?: number };
  sources: { toml: string[]; legacy: string[] };
}
```

- [ ] **Step 5: Delegate `src/config.ts` getters to the new resolver and sync `src/config.js`**

```ts
import {
  getResolvedConfig,
  getResolvedAgentLane,
  getResolvedEmbeddingLane,
  getResolvedMemoryLane,
} from './config/resolved-config.js';
```

- [ ] **Step 6: Run config tests**

Run: `npm test -- tests/config/toml-loader.test.ts tests/config/resolved-config.test.ts tests/config/embedding-api-key-aliases.test.ts tests/config/yaml-project-root.test.ts`
Expected: PASS, including proof that embedding lane still does not borrow agent or memory keys

- [ ] **Step 7: Commit**

```bash
git add src/config/toml-loader.ts src/config/resolved-config.ts src/config.ts src/config.js tests/config/toml-loader.test.ts tests/config/resolved-config.test.ts
git commit -m "feat: add TOML-first memorix config resolver"
```

### Task 3: Make `memorix init` and CLI Surface TOML-First

**Files:**
- Modify: `src/cli/commands/init.ts`
- Modify: `src/cli/index.ts`
- Create: `tests/cli/config-command.test.ts`
- Modify: `tests/cli/init.test.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/CONFIGURATION.md`

- [ ] **Step 1: Write the failing CLI tests for TOML-first init**

```ts
it('writes config.toml for global init', async () => {
  // run init with mocked prompts
  expect(existsSync(join(homeDir, '.memorix', 'config.toml'))).toBe(true);
  expect(existsSync(join(homeDir, '.memorix', 'memorix.yml'))).toBe(false);
});

it('registers memorix config path command', async () => {
  // invoke main command with ["config", "path"]
  expect(stdout).toContain('config.toml');
});
```

- [ ] **Step 2: Run CLI tests to verify they fail**

Run: `npm test -- tests/cli/init.test.ts tests/cli/config-command.test.ts`
Expected: FAIL because init still writes `memorix.yml` and `config` command does not exist

- [ ] **Step 3: Rewrite init to generate TOML**

```ts
const targetPath = path.join(targetDir, 'config.toml');
const lines: string[] = [
  '[memory.llm]',
  'provider = "openai"',
  'model = "gpt-4o-mini"',
  '',
  '[embedding]',
  'provider = "off"',
  '',
  '[memory]',
  'inject = "minimal"',
  'formation = "active"',
  'auto_cleanup = true',
];
```

- [ ] **Step 4: Add `memorix config path` and `memorix config get` skeleton commands**

```ts
config: () => Promise.resolve(defineCommand({
  meta: { name: 'config', description: 'Inspect Memorix config locations and values' },
  subCommands: {
    path: () => import('./commands/config-path.js').then(m => m.default),
    get: () => import('./commands/config-get.js').then(m => m.default),
  },
}))
```

- [ ] **Step 5: Update docs to describe TOML as the public config entry**

```md
- Primary config: `~/.memorix/config.toml`
- Project override: `<git-root>/memorix.toml`
- Legacy `memorix.yml` and `.env` are still read for compatibility
```

- [ ] **Step 6: Run CLI and doc-adjacent tests**

Run: `npm test -- tests/cli/init.test.ts tests/cli/config-command.test.ts tests/cli/init-shared.test.ts`
Expected: PASS, with init now writing TOML and config path command available

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/init.ts src/cli/index.ts tests/cli/init.test.ts tests/cli/config-command.test.ts README.md README.zh-CN.md docs/CONFIGURATION.md
git commit -m "feat: switch memorix init to TOML-first config"
```

### Task 4: Update `memorix status` to Explain Active Lanes Cleanly

**Files:**
- Modify: `src/cli/commands/status.ts`
- Modify: `src/config/resolved-config.ts`
- Test: `tests/config/resolved-config.test.ts`
- Test: `tests/cli/config-command.test.ts`

- [ ] **Step 1: Write the failing status output test**

```ts
it('shows TOML-first lane provenance with redacted credentials', async () => {
  expect(output).toContain('Agent lane');
  expect(output).toContain('Memory LLM lane');
  expect(output).toContain('Embedding lane');
  expect(output).toContain('<redacted>');
  expect(output).not.toContain('<configured-locally>');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/cli/config-command.test.ts tests/config/resolved-config.test.ts`
Expected: FAIL because `status` still reports YAML/dotenv-centric provenance

- [ ] **Step 3: Change `status.ts` to read the resolved config snapshot**

```ts
const resolved = getResolvedConfig({ projectRoot: project.rootPath });
diagLines.push(`  Agent lane:      ${resolved.agent.provider ?? 'unset'} / ${resolved.agent.model ?? 'unset'}`);
diagLines.push(`  Memory LLM lane: ${resolved.memory.llm.provider ?? 'unset'} / ${resolved.memory.llm.model ?? 'unset'}`);
diagLines.push(`  Embedding lane:  ${resolved.embedding.provider ?? 'off'} / ${resolved.embedding.model ?? 'unset'}`);
```

- [ ] **Step 4: Add one redaction helper and use it everywhere in status**

```ts
function redactValue(value?: string): string {
  if (!value) return 'not set';
  return '<redacted>';
}
```

- [ ] **Step 5: Run status-focused tests**

Run: `npm test -- tests/cli/config-command.test.ts tests/config/resolved-config.test.ts tests/config/embedding-api-key-aliases.test.ts`
Expected: PASS with lane-aware status output and no raw configured values shown

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/status.ts src/config/resolved-config.ts tests/cli/config-command.test.ts tests/config/resolved-config.test.ts
git commit -m "feat: show lane-based TOML config status"
```

### Task 5: Bridge `[agent]` Lane into Memcode Bootstrap

**Files:**
- Create: `packages/memcode/src/config/memorix-config-adapter.ts`
- Modify: `packages/memcode/src/cli.ts`
- Modify: `packages/memcode/src/core/model-resolver.ts`
- Test: `packages/memcode/test/memorix-config-adapter.test.ts`
- Test: `packages/memcode/test/model-resolver.test.ts`
- Test: `packages/memcode/test/config.test.ts`

- [ ] **Step 1: Write the failing memcode adapter tests**

```ts
it('applies agent lane defaults from Memorix config before main()', async () => {
  const env = {};
  applyMemorixAgentDefaults({
    agent: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'configured-in-test',
    },
  }, env);

  expect(env.MEMORIX_AGENT_PROVIDER).toBe('deepseek');
  expect(env.MEMORIX_AGENT_MODEL).toBe('deepseek-chat');
});

it('does not overwrite explicit process env values', async () => {
  const env = { MEMORIX_AGENT_MODEL: 'override-model' };
  applyMemorixAgentDefaults({ agent: { model: 'config-model' } }, env);
  expect(env.MEMORIX_AGENT_MODEL).toBe('override-model');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix packages/memcode test -- test/memorix-config-adapter.test.ts test/model-resolver.test.ts`
Expected: FAIL because adapter file does not exist

- [ ] **Step 3: Add the adapter**

```ts
export function applyMemorixAgentDefaults(
  config: { agent?: { provider?: string; model?: string; baseUrl?: string; apiKey?: string } },
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (config.agent?.provider && !env.MEMORIX_AGENT_PROVIDER && !env.MEMORIX_AGENT_LLM_PROVIDER) {
    env.MEMORIX_AGENT_PROVIDER = config.agent.provider;
  }
  if (config.agent?.model && !env.MEMORIX_AGENT_MODEL && !env.MEMORIX_AGENT_LLM_MODEL) {
    env.MEMORIX_AGENT_MODEL = config.agent.model;
  }
  if (config.agent?.baseUrl && !env.MEMORIX_AGENT_BASE_URL && !env.MEMORIX_AGENT_LLM_BASE_URL) {
    env.MEMORIX_AGENT_BASE_URL = config.agent.baseUrl;
  }
  if (config.agent?.apiKey && !env.MEMORIX_AGENT_API_KEY && !env.MEMORIX_AGENT_LLM_API_KEY) {
    env.MEMORIX_AGENT_API_KEY = config.agent.apiKey;
  }
}
```

- [ ] **Step 4: Load resolved Memorix config in `packages/memcode/src/cli.ts` before `main(args)`**

```ts
const { getResolvedConfigForCwd } = await import('../../../src/config/resolved-config.js');
const { applyMemorixAgentDefaults } = await import('./config/memorix-config-adapter.js');
applyMemorixAgentDefaults(getResolvedConfigForCwd(process.cwd()));
```

- [ ] **Step 5: Run memcode tests**

Run: `npm --prefix packages/memcode test -- test/memorix-config-adapter.test.ts test/model-resolver.test.ts test/config.test.ts`
Expected: PASS, with explicit env vars still winning over config defaults

- [ ] **Step 6: Commit**

```bash
git add packages/memcode/src/config/memorix-config-adapter.ts packages/memcode/src/cli.ts packages/memcode/src/core/model-resolver.ts packages/memcode/test/memorix-config-adapter.test.ts packages/memcode/test/model-resolver.test.ts packages/memcode/test/config.test.ts
git commit -m "feat(memcode): apply memorix agent lane defaults"
```

### Task 6: Add Migration Command and End-to-End Regression Coverage

**Files:**
- Create: `src/cli/commands/config-migrate.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/config/resolved-config.ts`
- Test: `tests/cli/config-command.test.ts`
- Test: `tests/config/resolved-config.test.ts`
- Test: `packages/memcode/test/memorix-config-adapter.test.ts`

- [ ] **Step 1: Write the failing migration test**

```ts
it('migrates legacy YAML values into config.toml without deleting legacy files', async () => {
  expect(existsSync(join(projectDir, 'config.toml'))).toBe(true);
  expect(readFileSync(join(projectDir, 'config.toml'), 'utf8')).toContain('[memory.llm]');
  expect(existsSync(join(projectDir, 'memorix.yml'))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/cli/config-command.test.ts tests/config/resolved-config.test.ts`
Expected: FAIL because `memorix config migrate` does not exist

- [ ] **Step 3: Implement `memorix config migrate` minimally**

```ts
const resolved = getResolvedConfig({ projectRoot });
const output = serializeResolvedConfigToToml(resolved);
writeFileSync(targetTomlPath, output, 'utf8');
```

- [ ] **Step 4: Add one end-to-end resolver test for `.git`-based project override safety**

```ts
it('only loads project memorix.toml after project root detection, not from nested arbitrary cwd aliases', () => {
  expect(getResolvedConfigForCwd(nestedPath).sources.toml).toContain(projectTomlPath);
});
```

- [ ] **Step 5: Run focused regression suite**

Run: `npm test -- tests/config/toml-loader.test.ts tests/config/resolved-config.test.ts tests/cli/init.test.ts tests/cli/config-command.test.ts tests/config/embedding-api-key-aliases.test.ts tests/config/yaml-project-root.test.ts`
Expected: PASS

- [ ] **Step 6: Run memcode regression suite**

Run: `npm --prefix packages/memcode test -- test/memorix-config-adapter.test.ts test/model-resolver.test.ts test/config.test.ts test/interactive-mode-memory-command.test.ts`
Expected: PASS

- [ ] **Step 7: Run build verification**

Run: `npm run build`
Expected: PASS

Run: `npm --prefix packages/memcode run build`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/config-migrate.ts src/cli/index.ts src/config/resolved-config.ts tests/cli/config-command.test.ts tests/config/resolved-config.test.ts packages/memcode/test/memorix-config-adapter.test.ts
git commit -m "feat: add TOML config migration and regression coverage"
```

## Spec Coverage Check

- TOML-first global and project entrypoints are covered by Tasks 1-3.
- `.git` project identity protection is covered by Tasks 1, 2, and 6.
- Agent/memory/embedding lane separation is covered by Tasks 2, 4, and 5.
- Memcode bootstrap compatibility is covered by Task 5.
- Status/config UX is covered by Tasks 3 and 4.
- Migration and compatibility are covered by Tasks 2 and 6.
- Documentation refresh is covered by Task 3.

## Self-Review

- Placeholder scan complete: no `TBD`, `TODO`, or "implement later" placeholders remain.
- Type consistency check complete: TOML uses `base_url`/`api_key` in file format and `baseUrl`/`apiKey` in resolved runtime objects consistently.
- Scope check complete: this is still one coherent subsystem, the unified config stack, with one execution path from loader to CLI to memcode bootstrap.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-14-unified-toml-config-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
