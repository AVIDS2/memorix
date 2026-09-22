import { Readable } from 'node:stream';
import os from 'node:os';
import { fromJsonSchema, McpServer as ModernMcpServer } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const project = {
  id: 'AVIDS2/repo',
  name: 'repo',
  rootPath: 'E:/repo',
};

const createMemorixServerMock = vi.fn();
const resolveServeProjectMock = vi.fn();
const detectProjectMock = vi.fn();
const detectProjectWithDiagnosticsMock = vi.fn();
const findGitInSubdirsMock = vi.fn();
const isSystemDirectoryMock = vi.fn();
const initTeamStoreMock = vi.fn();
const getProjectDataDirMock = vi.fn();
const getBaseDataDirMock = vi.fn();
const checkForUpdatesMock = vi.fn();
const listRootsMock = vi.fn();
const setNotificationHandlerMock = vi.fn();
const connectMock = vi.fn();
const switchProjectMock = vi.fn();
const deferredInitMock = vi.fn();
const activateProjectRuntimeMock = vi.fn().mockResolvedValue(undefined);
const isExplicitlyBoundMock = vi.fn();
const handleTransportCloseMock = vi.fn();
const {
  existsSyncMock,
  readFileSyncMock,
  writeFileSyncMock,
  mkdirSyncMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
}));
const createServerMock = vi.fn();
const httpServerListenMock = vi.fn();
const httpServerCloseMock = vi.fn();
const createControlPlaneMaintenanceWorkerMock = vi.fn();
const maintenanceWorkerStartMock = vi.fn();
const createModernMcpBridgeMock = vi.hoisted(() => vi.fn());
const createModernMcpRuntimeMock = vi.hoisted(() => vi.fn());
const serveStdioMock = vi.hoisted(() => vi.fn());
const withBusinessRuntimeQueueMock = vi.hoisted(() => vi.fn((work: () => Promise<unknown>) => work()));
const acquireDatabaseMock = vi.hoisted(() => vi.fn(() => ({ dataDir: 'test-data', db: {}, release: vi.fn() })));
const evictIdleDatabasesMock = vi.hoisted(() => vi.fn(() => 0));
const getDatabaseStatsMock = vi.hoisted(() => vi.fn(() => ({ cached: 0, leased: 0, leasedDataDirs: 0 })));

let capturedHttpHandler: ((req: any, res: any) => Promise<void>) | undefined;

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class StdioServerTransport {},
}));

vi.mock('@modelcontextprotocol/server/stdio', () => ({
  serveStdio: serveStdioMock,
  StdioServerTransport: class StdioServerTransport {
    constructor(..._args: unknown[]) {}
    async start() {}
    async close() {}
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class StreamableHTTPServerTransport {
    sessionId: string | undefined;
    onclose: (() => void) | undefined;
    private readonly options: any;

    constructor(options: any) {
      this.options = options;
    }

    async handleRequest(_req: any, res: any, body?: any) {
      this.sessionId = this.options.sessionIdGenerator?.() ?? 'session-1';
      this.options.onsessioninitialized?.(this.sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        result: body?.method === 'tools/list'
          ? { tools: [{ name: 'memorix_store' }] }
          : { protocolVersion: '2024-11-05', capabilities: { tools: {} } },
        id: body?.id ?? 1,
      }));
    }

    async close() {
      this.onclose?.();
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  RootsListChangedNotificationSchema: { name: 'roots/list_changed' },
  isInitializeRequest: (body: any) => body?.method === 'initialize',
}));

vi.mock('node:http', async () => {
  const actual = await vi.importActual<typeof import('node:http')>('node:http');
  return {
    ...actual,
    createServer: createServerMock.mockImplementation((handler: any) => {
      capturedHttpHandler = handler;
      return {
        listen: httpServerListenMock.mockImplementation((_port: number, _host: string, callback?: () => void) => {
          callback?.();
        }),
        close: httpServerCloseMock.mockImplementation((callback?: (err?: Error) => void) => {
          callback?.();
        }),
      };
    }),
  };
});

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'session-1'),
}));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => 'C:/Users/tester',
  };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock,
    mkdirSync: mkdirSyncMock,
  };
});

vi.mock('../../src/server.js', () => ({
  createMemorixServer: createMemorixServerMock,
}));

vi.mock('../../src/server/mcp-binding-store.js', () => ({
  McpBindingStore: class {
    async init() {}
    touch() { return undefined; }
    findByProjectRoot() { return undefined; }
    create() { return { handleId: 'test-handle', projectId: project.id, projectRoot: project.rootPath, dataDir: 'E:/memorix-data' }; }
  },
}));

vi.mock('../../src/server/modern-mcp-bridge.js', () => ({
  createModernMcpBridge: createModernMcpBridgeMock,
  createModernMcpRuntime: createModernMcpRuntimeMock,
  withBusinessRuntimeQueue: withBusinessRuntimeQueueMock,
  ModernMcpRuntimePool: class {
    private entries = new Set<any>();
    async createBridge(_key: string, factory: () => Promise<any>) {
      const runtime = await factory();
      this.entries.add(runtime);
      const bridge = await runtime.createBridge();
      const close = bridge.close.bind(bridge);
      bridge.close = async () => {
        await close();
        await runtime.close();
        this.entries.delete(runtime);
      };
      return bridge;
    }
    async evictIdle() { return 0; }
    async close() {
      await Promise.all([...this.entries].map((runtime: any) => runtime.close()));
      this.entries.clear();
    }
    stats() { return { entries: this.entries.size, activeRefs: 0, pending: 0 }; }
  },
}));

vi.mock('../../src/store/sqlite-db.js', () => ({
  acquireDatabase: acquireDatabaseMock,
  evictIdleDatabases: evictIdleDatabasesMock,
  getDatabaseStats: getDatabaseStatsMock,
}));

vi.mock('../../src/runtime/control-plane-maintenance.js', () => ({
  createControlPlaneMaintenanceWorker: createControlPlaneMaintenanceWorkerMock,
}));

vi.mock('../../src/cli/commands/serve-shared.js', () => ({
  resolveServeProject: resolveServeProjectMock,
}));

vi.mock('../../src/project/detector.js', () => ({
  detectProject: detectProjectMock,
  detectProjectWithDiagnostics: detectProjectWithDiagnosticsMock,
  findGitInSubdirs: findGitInSubdirsMock,
  isSystemDirectory: isSystemDirectoryMock,
}));

vi.mock('../../src/team/team-store.js', () => ({
  initTeamStore: initTeamStoreMock,
}));

vi.mock('../../src/store/persistence.js', () => ({
  getProjectDataDir: getProjectDataDirMock,
  getBaseDataDir: getBaseDataDirMock,
}));

vi.mock('../../src/cli/update-checker.js', () => ({
  checkForUpdates: checkForUpdatesMock,
}));

import serveCommand from '../../src/cli/commands/serve.js';
import serveHttpCommand from '../../src/cli/commands/serve-http.js';

function makeServerResult() {
  return {
    server: {
      connect: connectMock.mockResolvedValue(undefined),
      server: {
        listRoots: listRootsMock.mockResolvedValue({ roots: [] }),
        setNotificationHandler: setNotificationHandlerMock,
      },
    },
    projectId: project.id,
    deferredInit: deferredInitMock.mockResolvedValue(undefined),
    activateProjectRuntime: activateProjectRuntimeMock,
    switchProject: switchProjectMock.mockResolvedValue(false),
    isExplicitlyBound: isExplicitlyBoundMock.mockReturnValue(false),
    handleTransportClose: handleTransportCloseMock,
  };
}

function createFakeRequest(body: Record<string, unknown>) {
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf-8')]) as Readable & {
    headers: Record<string, string>;
    method: string;
    rawHeaders: string[];
    url: string;
  };
  req.headers = { 'content-type': 'application/json' };
  req.method = 'POST';
  req.rawHeaders = [];
  req.url = '/mcp';
  return req;
}

function createFakeResponse() {
  const headers = new Map<string, string>();
  let body = '';

  return {
    headersSent: false,
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    removeHeader(name: string) {
      headers.delete(name.toLowerCase());
    },
    writeHead(statusCode: number, ...rest: any[]) {
      this.statusCode = statusCode;
      this.headersSent = true;
      const maybeHeaders = rest.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
      if (maybeHeaders) {
        for (const [key, value] of Object.entries(maybeHeaders)) {
          headers.set(key.toLowerCase(), String(value));
        }
      }
      return this;
    },
    write(chunk: any, ...args: any[]) {
      if (chunk != null) {
        body += Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
          ? Buffer.from(chunk).toString('utf-8')
          : String(chunk);
      }
      const callback = args.at(-1);
      if (typeof callback === 'function') callback();
      return true;
    },
    end(chunk?: any, ...args: any[]) {
      if (chunk != null && typeof chunk !== 'function') {
        body += Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
          ? Buffer.from(chunk).toString('utf-8')
          : String(chunk);
      }
      const callback = typeof chunk === 'function' ? chunk : args.at(-1);
      if (typeof callback === 'function') callback();
      return this;
    },
    on() {
      return this;
    },
    destroyed: false,
    getBody() {
      return body;
    },
  };
}

describe('serve command mode support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHttpHandler = undefined;
    process.env.MEMORIX_MODE = undefined;
    process.env.MEMORIX_PROJECT_ROOT = undefined;
    process.env.INIT_CWD = undefined;

    resolveServeProjectMock.mockReturnValue({
      detectedProject: project,
      projectRoot: project.rootPath,
      source: 'direct',
      messages: [],
    });
    detectProjectMock.mockImplementation((cwd: string) => (cwd === project.rootPath ? project : null));
    detectProjectWithDiagnosticsMock.mockImplementation((cwd: string) => ({
      project: cwd === project.rootPath ? project : null,
      diagnostics: [],
    }));
    findGitInSubdirsMock.mockReturnValue(null);
    isSystemDirectoryMock.mockReturnValue(false);
    initTeamStoreMock.mockResolvedValue({});
    getProjectDataDirMock.mockResolvedValue('E:/memorix-data');
    getBaseDataDirMock.mockReturnValue(os.tmpdir());
    createMemorixServerMock.mockResolvedValue(makeServerResult());
    createModernMcpBridgeMock.mockImplementation(async () => {
      const modern = new ModernMcpServer({ name: 'test-modern', version: '1.0.0' });
      modern.registerTool(
        'memorix_store',
        {
          inputSchema: fromJsonSchema({ type: 'object', additionalProperties: false }),
        },
        async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      );
      return modern;
    });
    createModernMcpRuntimeMock.mockImplementation(async (options: any) => {
      return {
        projectId: project.id,
        getProjectDataDir: () => 'E:/memorix-data',
        createBridge: () => createModernMcpBridgeMock(options),
        close: async () => {},
      };
    });
    serveStdioMock.mockImplementation((factory: () => Promise<unknown>) => {
      void factory();
      return { close: vi.fn() };
    });
    existsSyncMock.mockReturnValue(false);
    readFileSyncMock.mockReturnValue('');
    checkForUpdatesMock.mockResolvedValue(undefined);
    vi.spyOn(process, 'cwd').mockReturnValue(project.rootPath);
    vi.spyOn(process.stdin, 'on').mockImplementation(() => process.stdin);
    vi.spyOn(process, 'on').mockImplementation(() => process);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MEMORIX_MODE;
    delete process.env.MEMORIX_PROJECT_ROOT;
    delete process.env.INIT_CWD;
  });

  it('declares a mode arg for stdio profile selection', () => {
    const args = serveCommand.args as Record<string, any> | undefined;

    expect(args).toHaveProperty('mode');
    expect(args?.mode?.type).toBe('string');
    expect(args?.mode?.description).toContain('micro');
    expect(args?.mode?.description).toContain('lite');
  });

  it('defaults stdio mode to micro to keep agent tool lists compact', async () => {
    const run = serveCommand.run as ((input: any) => Promise<void>) | undefined;

    await run?.({
      args: {
        cwd: project.rootPath,
        'allow-untracked': false,
      },
    } as any);

    expect(createModernMcpBridgeMock.mock.calls[0]?.[0]).toMatchObject({ toolProfile: 'micro' });
  });

  it('passes an explicit stdio mode through to createMemorixServer', async () => {
    const run = serveCommand.run as ((input: any) => Promise<void>) | undefined;

    await run?.({
      args: {
        cwd: project.rootPath,
        mode: 'full',
        'allow-untracked': false,
      },
    } as any);

    expect(createModernMcpBridgeMock).toHaveBeenCalledTimes(1);
    expect(createModernMcpBridgeMock.mock.calls[0]?.[0]).toMatchObject({ toolProfile: 'full' });
  });

  it('uses MEMORIX_MODE as the stdio fallback when mode is omitted', async () => {
    process.env.MEMORIX_MODE = 'team';

    const run = serveCommand.run as ((input: any) => Promise<void>) | undefined;

    await run?.({
      args: {
        cwd: project.rootPath,
        'allow-untracked': false,
      },
    } as any);

    expect(createModernMcpBridgeMock.mock.calls[0]?.[0]).toMatchObject({ toolProfile: 'team' });
  });
});

describe('serve-http command mode support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHttpHandler = undefined;
    process.env.MEMORIX_MODE = undefined;
    process.env.MEMORIX_PROJECT_ROOT = undefined;

    resolveServeProjectMock.mockReturnValue({
      detectedProject: project,
      projectRoot: project.rootPath,
      source: 'direct',
      messages: [],
    });
    detectProjectMock.mockImplementation((cwd: string) => (cwd === project.rootPath ? project : null));
    detectProjectWithDiagnosticsMock.mockImplementation((cwd: string) => ({
      project: cwd === project.rootPath ? project : null,
      diagnostics: [],
    }));
    findGitInSubdirsMock.mockReturnValue(null);
    initTeamStoreMock.mockResolvedValue({});
    getProjectDataDirMock.mockResolvedValue('E:/memorix-data');
    getBaseDataDirMock.mockReturnValue(os.tmpdir());
    createControlPlaneMaintenanceWorkerMock.mockReturnValue({ start: maintenanceWorkerStartMock });
    createMemorixServerMock.mockResolvedValue(makeServerResult());
    createModernMcpBridgeMock.mockImplementation(async () => {
      const modern = new ModernMcpServer({ name: 'test-modern', version: '1.0.0' });
      modern.registerTool(
        'memorix_store',
        {
          inputSchema: fromJsonSchema({ type: 'object', additionalProperties: false }),
        },
        async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      );
      return modern;
    });
    createModernMcpRuntimeMock.mockImplementation(async (options: any) => ({
      projectId: project.id,
      getProjectDataDir: () => 'E:/memorix-data',
      createBridge: () => createModernMcpBridgeMock(options),
      close: async () => {},
    }));
    createServerMock.mockImplementation((handler: any) => {
      capturedHttpHandler = handler;
      return {
        listen: httpServerListenMock.mockImplementation((_port: number, _host: string, callback?: () => void) => {
          callback?.();
        }),
        close: httpServerCloseMock.mockImplementation((callback?: (err?: Error) => void) => {
          callback?.();
        }),
      };
    });
    existsSyncMock.mockReturnValue(false);
    readFileSyncMock.mockReturnValue('');
    vi.spyOn(process, 'cwd').mockReturnValue(project.rootPath);
    vi.spyOn(process, 'on').mockImplementation(() => process);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MEMORIX_MODE;
    delete process.env.MEMORIX_PROJECT_ROOT;
  });

  it('declares a mode arg for HTTP profile selection', () => {
    const args = serveHttpCommand.args as Record<string, any> | undefined;

    expect(args).toHaveProperty('mode');
    expect(args?.mode?.type).toBe('string');
    expect(args?.mode?.description).toContain('team');
  });

  it('passes an explicit HTTP mode through on initialize', async () => {
    const run = serveHttpCommand.run as ((input: any) => Promise<void>) | undefined;

    await run?.({
      args: {
        cwd: project.rootPath,
        host: '127.0.0.1',
        port: '3211',
        mode: 'full',
      },
    } as any);

    expect(capturedHttpHandler).toBeTypeOf('function');

    const req = createFakeRequest({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '1.0.0' },
      },
      id: 1,
    });
    const res = createFakeResponse();

    await capturedHttpHandler!(req, res as any);

    expect(createMemorixServerMock).toHaveBeenCalledTimes(1);
    expect(createMemorixServerMock.mock.calls[0]?.[3]).toMatchObject({ toolProfile: 'full' });
    expect(createControlPlaneMaintenanceWorkerMock).toHaveBeenCalledWith('E:/memorix-data', { pollIntervalMs: 2_000 });
    expect(maintenanceWorkerStartMock).toHaveBeenCalledTimes(1);
  });

  it('serves current-protocol tools/list without a project handle', async () => {
    const run = serveHttpCommand.run as ((input: any) => Promise<void>) | undefined;

    await run?.({
      args: {
        cwd: project.rootPath,
        host: '127.0.0.1',
        port: '3211',
      },
    } as any);

    expect(capturedHttpHandler).toBeTypeOf('function');

    const discoverReq = createFakeRequest({
      jsonrpc: '2.0',
      method: 'server/discover',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'vitest', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
      id: 1,
    });
    discoverReq.headers['mcp-protocol-version'] = '2026-07-28';
    discoverReq.headers['mcp-method'] = 'server/discover';
    discoverReq.rawHeaders = [
      'content-type', 'application/json',
      'mcp-protocol-version', '2026-07-28',
      'mcp-method', 'server/discover',
    ];
    const discoverRes = createFakeResponse();
    await capturedHttpHandler!(discoverReq, discoverRes as any);
    expect(discoverRes.statusCode).toBe(200);

    const listReq = createFakeRequest({
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'vitest', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
      id: 2,
    });
    listReq.headers['mcp-protocol-version'] = '2026-07-28';
    listReq.headers['mcp-method'] = 'tools/list';
    listReq.rawHeaders = [
      'content-type', 'application/json',
      'mcp-protocol-version', '2026-07-28',
      'mcp-method', 'tools/list',
    ];
    const listRes = createFakeResponse();

    await capturedHttpHandler!(listReq, listRes as any);

    expect(listRes.statusCode).toBe(200);
    expect(JSON.parse(listRes.getBody()).result.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'memorix_store' })]),
    );
  });

  it('uses MEMORIX_MODE as the HTTP fallback when mode is omitted', async () => {
    process.env.MEMORIX_MODE = 'lite';

    const run = serveHttpCommand.run as ((input: any) => Promise<void>) | undefined;

    await run?.({
      args: {
        cwd: project.rootPath,
        host: '127.0.0.1',
        port: '3211',
      },
    } as any);

    expect(capturedHttpHandler).toBeTypeOf('function');

    const req = createFakeRequest({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '1.0.0' },
      },
      id: 1,
    });
    const res = createFakeResponse();

    await capturedHttpHandler!(req, res as any);

    expect(createMemorixServerMock.mock.calls[0]?.[3]).toMatchObject({ toolProfile: 'lite' });
  });
});
