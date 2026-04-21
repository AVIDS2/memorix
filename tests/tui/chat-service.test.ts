import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDetectProject = vi.fn();
const mockLoadDotenv = vi.fn();
const mockInitLLM = vi.fn();
const mockIsLLMEnabled = vi.fn();
const mockCallLLMWithTools = vi.fn();
const mockCallLLMWithToolsStream = vi.fn();
const mockGetLLMConfig = vi.fn();
const mockInitObservations = vi.fn();
const mockStoreObservation = vi.fn();
const mockResolveObservations = vi.fn();
const mockGetObservation = vi.fn();
const mockGetAllObservations = vi.fn();
const mockGetProjectDataDir = vi.fn();
const mockInitObservationStore = vi.fn();
const mockLoadAll = vi.fn();
const mockGetDb = vi.fn();
const mockHydrateIndex = vi.fn();
const mockCompactSearch = vi.fn();
const mockCompactDetail = vi.fn();
const mockGetLastSearchMode = vi.fn();

vi.mock('../../src/project/detector.js', () => ({
  detectProject: mockDetectProject,
}));

vi.mock('../../src/config/dotenv-loader.js', () => ({
  loadDotenv: mockLoadDotenv,
}));

vi.mock('../../src/llm/provider.js', () => ({
  initLLM: mockInitLLM,
  isLLMEnabled: mockIsLLMEnabled,
  callLLM: vi.fn(),
  callLLMWithTools: mockCallLLMWithTools,
  callLLMWithToolsStream: mockCallLLMWithToolsStream,
  getLLMConfig: mockGetLLMConfig,
}));

vi.mock('../../src/memory/observations.js', () => ({
  initObservations: mockInitObservations,
  storeObservation: mockStoreObservation,
  resolveObservations: mockResolveObservations,
  getObservation: mockGetObservation,
  getAllObservations: mockGetAllObservations,
}));

vi.mock('../../src/store/persistence.js', () => ({
  getProjectDataDir: mockGetProjectDataDir,
}));

vi.mock('../../src/store/obs-store.js', () => ({
  initObservationStore: mockInitObservationStore,
  getObservationStore: () => ({
    loadAll: mockLoadAll,
  }),
}));

vi.mock('../../src/store/orama-store.js', () => ({
  getDb: mockGetDb,
  hydrateIndex: mockHydrateIndex,
  getLastSearchMode: mockGetLastSearchMode,
}));

vi.mock('../../src/compact/engine.js', () => ({
  compactSearch: mockCompactSearch,
  compactDetail: mockCompactDetail,
}));

describe('askMemoryQuestion (agentic harness)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockDetectProject.mockReturnValue({
      id: 'proj-1',
      name: 'memorix',
      rootPath: '/repo',
      gitRemote: 'origin',
    });
    mockGetProjectDataDir.mockResolvedValue('/repo/.memorix');
    mockLoadAll.mockResolvedValue([]);
    mockGetDb.mockResolvedValue({});
    mockHydrateIndex.mockResolvedValue(undefined);
    mockCompactSearch.mockResolvedValue({
      entries: [
        { id: 11, score: 0.93 },
      ],
      formatted: '',
      totalTokens: 0,
    });
    mockCompactDetail.mockResolvedValue({
      documents: [
        {
          id: 'proj-1:11',
          observationId: 11,
          entityName: 'auth',
          type: 'decision',
          title: 'Use token refresh flow',
          narrative: 'The auth layer uses rotating refresh tokens.',
          facts: 'Refresh TTL: 30d',
          filesModified: 'src/auth.ts',
          concepts: 'auth,refresh-token',
          tokens: 30,
          createdAt: '2026-04-18',
          projectId: 'proj-1',
          accessCount: 0,
          lastAccessedAt: '',
          status: 'active',
          source: 'agent',
          sourceDetail: '',
          valueCategory: '',
        },
      ],
      formatted: '',
      totalTokens: 0,
    });
    mockGetLastSearchMode.mockReturnValue('hybrid');
    mockGetLLMConfig.mockReturnValue({ model: 'gpt-4.1-nano' });
  });

  it('returns a project warning when no git project is detected', async () => {
    mockDetectProject.mockReturnValue(null);
    const { askMemoryQuestion } = await import('../../src/cli/tui/chat-service.js');

    const result = await askMemoryQuestion('Why did we choose SQLite?');

    expect(result.usedLLM).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.answer).toContain('No project detected');
  });

  it('falls back to sourced summaries when LLM is not configured', async () => {
    mockIsLLMEnabled.mockReturnValue(false);
    const { askMemoryQuestion } = await import('../../src/cli/tui/chat-service.js');

    const result = await askMemoryQuestion('How does auth work?');

    expect(mockInitLLM).toHaveBeenCalled();
    expect(result.usedLLM).toBe(false);
    expect(result.searchMode).toBe('hybrid');
    expect(result.sources).toHaveLength(1);
    expect(result.answer).toContain('LLM chat is not configured');
    expect(result.answer).toContain('[obs:11]');
  });

  it('handles casual chat without calling any tools (agentic harness)', async () => {
    mockIsLLMEnabled.mockReturnValue(true);
    // LLM responds directly without tool calls
    mockCallLLMWithTools.mockResolvedValue({
      content: '你好！我是 Memorix，你的项目记忆助手。有什么想了解的吗？',
      toolCalls: [],
      stopReason: 'stop',
    });

    const { askMemoryQuestion } = await import('../../src/cli/tui/chat-service.js');
    const result = await askMemoryQuestion('你好');

    expect(result.usedLLM).toBe(true);
    expect(result.sources).toEqual([]);
    expect(result.answer).toContain('Memorix');
    expect(result.toolCallsCount).toBe(0);
    // Verify the system prompt was included
    const [messages] = mockCallLLMWithTools.mock.calls[0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('casual conversation');
  });

  it('uses search_memories tool when user asks about project details', async () => {
    mockIsLLMEnabled.mockReturnValue(true);

    // Round 1: LLM decides to call search_memories
    mockCallLLMWithTools.mockResolvedValueOnce({
      content: '',
      toolCalls: [{
        id: 'call_1',
        name: 'search_memories',
        arguments: JSON.stringify({ query: 'auth architecture' }),
      }],
      stopReason: 'tool_use',
    });

    // Round 2: LLM synthesizes answer from tool results
    mockCallLLMWithTools.mockResolvedValueOnce({
      content: 'The auth layer uses rotating refresh tokens [obs:11].',
      toolCalls: [],
      stopReason: 'stop',
    });

    const { askMemoryQuestion } = await import('../../src/cli/tui/chat-service.js');
    const result = await askMemoryQuestion('How does auth work?');

    expect(result.usedLLM).toBe(true);
    expect(result.llmModel).toBe('gpt-4.1-nano');
    expect(result.answer).toContain('[obs:11]');
    expect(result.toolCallsCount).toBe(1);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].id).toBe(11);
    // Verify search was called with the LLM's query
    expect(mockCompactSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'auth architecture' }),
    );
  });

  it('normalizes raw searchMode labels for display', async () => {
    mockIsLLMEnabled.mockReturnValue(false);
    mockGetLastSearchMode.mockReturnValue('vector-only (hybrid empty fallback)');

    const { askMemoryQuestion } = await import('../../src/cli/tui/chat-service.js');
    const result = await askMemoryQuestion('How does auth work?');

    expect(result.searchMode).toBe('vector');
  });

  it('supports multi-step tool calls (search then detail)', async () => {
    mockIsLLMEnabled.mockReturnValue(true);

    // Round 1: LLM calls search_memories
    mockCallLLMWithTools.mockResolvedValueOnce({
      content: '',
      toolCalls: [{
        id: 'call_1',
        name: 'search_memories',
        arguments: JSON.stringify({ query: 'embedding setup' }),
      }],
      stopReason: 'tool_use',
    });

    // Round 2: LLM calls get_memory_detail on a result
    mockCallLLMWithTools.mockResolvedValueOnce({
      content: '',
      toolCalls: [{
        id: 'call_2',
        name: 'get_memory_detail',
        arguments: JSON.stringify({ id: 11 }),
      }],
      stopReason: 'tool_use',
    });

    // Round 3: LLM synthesizes final answer
    mockCallLLMWithTools.mockResolvedValueOnce({
      content: 'The embedding setup uses ONNX quantized models [obs:11].',
      toolCalls: [],
      stopReason: 'stop',
    });

    const { askMemoryQuestion } = await import('../../src/cli/tui/chat-service.js');
    const result = await askMemoryQuestion('Tell me about the embedding setup');

    expect(result.usedLLM).toBe(true);
    expect(result.toolCallsCount).toBe(2);
    expect(result.answer).toContain('[obs:11]');
    expect(mockCallLLMWithTools).toHaveBeenCalledTimes(3); // 2 tool rounds + 1 final
  });

  it('uses store_memory tool when LLM decides to save a memory', async () => {
    mockIsLLMEnabled.mockReturnValue(true);
    mockStoreObservation.mockResolvedValue({
      observation: { id: 42, title: 'Auth timeout config', type: 'decision', entityName: 'auth', narrative: 'Set timeout to 60s' },
      upserted: false,
    });

    // Round 1: LLM calls store_memory
    mockCallLLMWithTools.mockResolvedValueOnce({
      content: '',
      toolCalls: [{
        id: 'call_store',
        name: 'store_memory',
        arguments: JSON.stringify({
          entityName: 'auth',
          type: 'decision',
          title: 'Auth timeout config',
          narrative: 'Set timeout to 60s',
        }),
      }],
      stopReason: 'tool_use',
    });

    // Round 2: LLM confirms the store
    mockCallLLMWithTools.mockResolvedValueOnce({
      content: 'I\'ve stored that decision for you [obs:42].',
      toolCalls: [],
      stopReason: 'stop',
    });

    const { askMemoryQuestion } = await import('../../src/cli/tui/chat-service.js');
    const result = await askMemoryQuestion('Remember: auth timeout is 60s');

    expect(mockStoreObservation).toHaveBeenCalledWith(
      expect.objectContaining({ entityName: 'auth', type: 'decision', title: 'Auth timeout config' }),
    );
    expect(result.toolCallsCount).toBe(1);
    expect(result.answer).toContain('[obs:42]');
  });

  it('uses delete_memory tool to archive an observation', async () => {
    mockIsLLMEnabled.mockReturnValue(true);
    mockGetObservation.mockReturnValue({
      id: 11, title: 'Old note', type: 'discovery', entityName: 'test',
      narrative: 'old', facts: [], projectId: 'proj-1', status: 'active',
    });
    mockResolveObservations.mockResolvedValue({ resolved: [11], notFound: [] });

    // Round 1: LLM calls delete_memory
    mockCallLLMWithTools.mockResolvedValueOnce({
      content: '',
      toolCalls: [{
        id: 'call_del',
        name: 'delete_memory',
        arguments: JSON.stringify({ id: 11, reason: 'outdated' }),
      }],
      stopReason: 'tool_use',
    });

    // Round 2: LLM confirms
    mockCallLLMWithTools.mockResolvedValueOnce({
      content: 'Archived observation [obs:11].',
      toolCalls: [],
      stopReason: 'stop',
    });

    const { askMemoryQuestion } = await import('../../src/cli/tui/chat-service.js');
    const result = await askMemoryQuestion('Delete memory 11, it\'s outdated');

    expect(mockResolveObservations).toHaveBeenCalledWith([11], 'resolved');
    expect(result.toolCallsCount).toBe(1);
  });

  it('uses list_recent_memories tool to browse memories', async () => {
    mockIsLLMEnabled.mockReturnValue(true);
    mockGetAllObservations.mockReturnValue([
      { id: 1, title: 'Note A', type: 'decision', entityName: 'auth', facts: [], projectId: 'proj-1', status: 'active', createdAt: '2026-04-18' },
      { id: 2, title: 'Note B', type: 'gotcha', entityName: 'db', facts: [], projectId: 'proj-1', status: 'active', createdAt: '2026-04-17' },
    ]);

    // Round 1: LLM calls list_recent_memories
    mockCallLLMWithTools.mockResolvedValueOnce({
      content: '',
      toolCalls: [{
        id: 'call_list',
        name: 'list_recent_memories',
        arguments: JSON.stringify({ limit: 5 }),
      }],
      stopReason: 'tool_use',
    });

    // Round 2: LLM presents the list
    mockCallLLMWithTools.mockResolvedValueOnce({
      content: 'Here are your recent memories:\n- Note A\n- Note B',
      toolCalls: [],
      stopReason: 'stop',
    });

    const { askMemoryQuestion } = await import('../../src/cli/tui/chat-service.js');
    const result = await askMemoryQuestion('Show me recent memories');

    expect(mockGetAllObservations).toHaveBeenCalled();
    expect(result.toolCallsCount).toBe(1);
  });

  it('passes abort through the non-streaming LLM path', async () => {
    mockIsLLMEnabled.mockReturnValue(true);
    const ac = new AbortController();
    mockCallLLMWithTools.mockImplementation(async (_messages: unknown, _tools: unknown, signal?: AbortSignal) => {
      expect(signal).toBe(ac.signal);
      ac.abort(new DOMException('User cancelled', 'AbortError'));
      signal?.throwIfAborted();
      return {
        content: 'full buffered answer',
        toolCalls: [],
        stopReason: 'stop',
      };
    });

    const { askMemoryQuestionStream } = await import('../../src/cli/tui/chat-service.js');
    const chunks: string[] = [];

    await expect(askMemoryQuestionStream(
      'Hello?',
      [],
      {
        onChunk: (text) => {
          chunks.push(text);
        },
      },
      ac.signal,
    )).rejects.toThrow();

    expect(chunks).toEqual([]);
    expect(mockCallLLMWithTools).toHaveBeenCalledTimes(1);
    expect(mockCallLLMWithToolsStream).not.toHaveBeenCalled();
  });
});
