import { afterEach, describe, expect, it, vi } from 'vitest';

const detectProjectMock = vi.fn();
const homedirMock = vi.fn(() => 'C:\\Users\\Tester');
const infoMock = vi.fn();
const warnMock = vi.fn();
const noteMock = vi.fn();
const introMock = vi.fn();
const outroMock = vi.fn();

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
});
