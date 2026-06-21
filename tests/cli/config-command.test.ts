import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const detectProjectMock = vi.fn();
const homedirMock = vi.fn(() => 'C:\\Users\\Tester');
const infoMock = vi.fn();
const warnMock = vi.fn();
const noteMock = vi.fn();
const introMock = vi.fn();
const outroMock = vi.fn();
let tempDir: string | undefined;

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: homedirMock };
});

vi.mock('@clack/prompts', () => ({
  log: {
    info: infoMock,
    warn: warnMock,
    error: vi.fn(),
  },
  note: noteMock,
  intro: introMock,
  outro: outroMock,
}));

vi.mock('../../src/project/detector.js', () => ({
  detectProject: detectProjectMock,
}));

vi.mock('../../src/rules/syncer.js', () => ({
  RulesSyncer: class {
    async syncStatus() {
      return { sources: [], totalRules: 0, uniqueRules: 0, conflicts: [] };
    }
  },
}));

vi.mock('../../src/store/persistence.js', () => ({
  getProjectDataDir: vi.fn(async () => 'E:\\repo\\demo\\.memorix'),
}));

vi.mock('../../src/embedding/provider.js', () => ({
  getEmbeddingProvider: vi.fn(async () => null),
}));

vi.mock('../../src/store/obs-store.js', () => ({
  initObservationStore: vi.fn(async () => undefined),
  getObservationStore: vi.fn(() => ({ loadAll: vi.fn(async () => []) })),
}));

vi.mock('../../src/config/dotenv-loader.js', () => ({
  loadDotenv: vi.fn(),
  getLoadedEnvFiles: vi.fn(() => []),
}));

vi.mock('../../src/git/hooks-path.js', () => ({
  resolveHooksDir: vi.fn(() => null),
}));

describe('memorix config commands', () => {
  afterEach(() => {
    delete process.env.MEMORIX_AGENT_MODEL;
    delete process.env.MEMORIX_AGENT_API_KEY;
    delete process.env.MEMORIX_AGENT_BASE_URL;
    delete process.env.MEMORIX_LLM_API_KEY;
    delete process.env.MEMORIX_LLM_MODEL;
    delete process.env.MEMORIX_LLM_BASE_URL;
    delete process.env.MEMORIX_EMBEDDING_API_KEY;
    delete process.env.MEMORIX_EMBEDDING_MODEL;
    delete process.env.MEMORIX_EMBEDDING_BASE_URL;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    homedirMock.mockReturnValue('C:\\Users\\Tester');
    vi.clearAllMocks();
  });

  it('prints global and project TOML config paths', async () => {
    detectProjectMock.mockReturnValue({ rootPath: 'E:\\repo\\demo' });
    const command = (await import('../../src/cli/commands/config-path.js')).default;

    await command.run?.({ args: {}, rawArgs: [], cmd: command } as any);

    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining('config.toml'),
      'Memorix config',
    );
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining('memorix.toml'),
      'Memorix config',
    );
  });

  it('prints resolved config values through dotted keys', async () => {
    process.env.MEMORIX_AGENT_MODEL = 'test-model';
    const command = (await import('../../src/cli/commands/config-get.js')).default;

    await command.run?.({ args: { key: 'agent.model' }, rawArgs: ['agent.model'], cmd: command } as any);

    expect(infoMock).toHaveBeenCalledWith('agent.model: test-model');
  });

  it('redacts only sensitive config keys when printing dotted values', async () => {
    process.env.MEMORIX_EMBEDDING_MODEL = 'text-embedding-v4';
    process.env.MEMORIX_EMBEDDING_API_KEY = 'embedding-test-secret';
    const command = (await import('../../src/cli/commands/config-get.js')).default;

    await command.run?.({ args: { key: 'embedding.model' }, rawArgs: ['embedding.model'], cmd: command } as any);
    await command.run?.({ args: { key: 'embedding.apiKey' }, rawArgs: ['embedding.apiKey'], cmd: command } as any);

    expect(infoMock).toHaveBeenCalledWith('embedding.model: text-embedding-v4');
    expect(infoMock).toHaveBeenCalledWith('embedding.apiKey: <redacted>');
    expect(infoMock).not.toHaveBeenCalledWith(expect.stringContaining('embedding-test-secret'));
  });


  it('shows lane-based status without leaking credentials', async () => {
    detectProjectMock.mockReturnValue({
      id: 'demo-id',
      name: 'demo',
      rootPath: 'E:\\repo\\demo',
      gitRemote: null,
    });
    process.env.MEMORIX_AGENT_MODEL = 'status-model';
    process.env.MEMORIX_AGENT_API_KEY = 'status-secret-key';
    const command = (await import('../../src/cli/commands/status.js')).default;

    await command.run?.({ args: {}, rawArgs: [], cmd: command } as any);

    const notes = noteMock.mock.calls.map(([body]) => String(body)).join('\n');
    expect(notes).toContain('Agent lane');
    expect(notes).toContain('Memory LLM lane');
    expect(notes).toContain('Embedding lane');
    expect(notes).toContain('<redacted>');
    expect(notes).not.toContain('status-secret-key');
  });

  it('migrates legacy YAML into project memorix.toml without deleting legacy files or env secrets', async () => {
    tempDir = mkdtempSync(join(process.env.TEMP ?? process.cwd(), 'memorix-config-migrate-'));
    const homeDir = join(tempDir, 'home');
    const projectDir = join(tempDir, 'project');
    mkdirSync(join(homeDir, '.memorix'), { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    homedirMock.mockReturnValue(homeDir);
    detectProjectMock.mockReturnValue({
      id: 'local/project',
      name: 'project',
      rootPath: projectDir,
      gitRemote: null,
    });
    writeFileSync(join(projectDir, 'memorix.yml'), [
      'llm:',
      '  provider: deepseek',
      '  model: deepseek-chat',
      'git:',
      '  autoHook: true',
      '  maxDiffSize: 2048',
      '  excludePatterns:',
      '    - dist/**',
      '    - "*.lock"',
      'behavior:',
      '  sessionInject: minimal',
    ].join('\n'), 'utf8');
    process.env.MEMORIX_LLM_API_KEY = 'env-secret-key-that-must-not-be-written';
    const command = (await import('../../src/cli/commands/config-migrate.js')).default;

    await command.run?.({ args: {}, rawArgs: [], cmd: command } as any);

    const target = join(projectDir, 'memorix.toml');
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(projectDir, 'memorix.yml'))).toBe(true);
    const content = readFileSync(target, 'utf8');
    expect(content).toContain('[memory.llm]');
    expect(content).toContain('provider = "deepseek"');
    expect(content).toContain('[git]');
    expect(content).toContain('auto_hook = true');
    expect(content).toContain('max_diff_size = 2048');
    expect(content).toContain('exclude_patterns = ["dist/**", "*.lock"]');
    expect(content).not.toContain('env-secret-key-that-must-not-be-written');
  });

  it('migrates environment-backed secrets into global config.toml only', async () => {
    tempDir = mkdtempSync(join(process.env.TEMP ?? process.cwd(), 'memorix-config-global-migrate-'));
    const homeDir = join(tempDir, 'home');
    mkdirSync(join(homeDir, '.memorix'), { recursive: true });
    homedirMock.mockReturnValue(homeDir);
    detectProjectMock.mockReturnValue(null);
    process.env.MEMORIX_AGENT_MODEL = 'agent-test-model';
    process.env.MEMORIX_AGENT_BASE_URL = 'https://agent.example/v1';
    process.env.MEMORIX_AGENT_API_KEY = 'agent-test-secret';
    process.env.MEMORIX_LLM_MODEL = 'memory-test-model';
    process.env.MEMORIX_LLM_BASE_URL = 'https://memory.example/v1';
    process.env.MEMORIX_LLM_API_KEY = 'memory-test-secret';
    process.env.MEMORIX_EMBEDDING_MODEL = 'embed-test-model';
    process.env.MEMORIX_EMBEDDING_BASE_URL = 'https://embed.example/v1';
    process.env.MEMORIX_EMBEDDING_API_KEY = 'embedding-test-secret';
    const command = (await import('../../src/cli/commands/config-migrate.js')).default;

    await command.run?.({ args: { global: true }, rawArgs: ['--global'], cmd: command } as any);

    const target = join(homeDir, '.memorix', 'config.toml');
    expect(existsSync(target)).toBe(true);
    const content = readFileSync(target, 'utf8');
    expect(content).toContain('[agent]');
    expect(content).toContain('model = "agent-test-model"');
    expect(content).toContain('api_key = "agent-test-secret"');
    expect(content).toContain('[memory.llm]');
    expect(content).toContain('model = "memory-test-model"');
    expect(content).toContain('api_key = "memory-test-secret"');
    expect(content).toContain('[embedding]');
    expect(content).toContain('model = "embed-test-model"');
    expect(content).toContain('api_key = "embedding-test-secret"');
  });
});
