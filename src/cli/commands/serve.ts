/**
 * memorix serve — Start MCP Server on stdio
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'serve',
    description: 'Start Memorix MCP Server on stdio transport',
  },
  args: {
    cwd: {
      type: 'string',
      description: 'Project working directory (defaults to process.cwd())',
      required: false,
    },
  },
  run: async ({ args }) => {
    const { StdioServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/stdio.js'
    );
    const { McpServer } = await import(
      '@modelcontextprotocol/sdk/server/mcp.js'
    );
    const { createMemorixServer } = await import('../../server.js');
    const { detectProject } = await import('../../project/detector.js');
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    // Priority: explicit --cwd arg > MEMORIX_PROJECT_ROOT env > INIT_CWD (npm lifecycle) > process.cwd()
    let safeCwd: string;
    try { safeCwd = process.cwd(); } catch { safeCwd = (await import('node:os')).homedir(); }
    let projectRoot = args.cwd || process.env.MEMORIX_PROJECT_ROOT || process.env.INIT_CWD || safeCwd;

    console.error(`[memorix] Starting with cwd: ${projectRoot}`);

    // Lightweight check: does this look like a valid project directory?
    const looksValid = existsSync(join(projectRoot, '.git'))
      || existsSync(join(projectRoot, 'package.json'))
      || existsSync(join(projectRoot, 'Cargo.toml'))
      || existsSync(join(projectRoot, 'go.mod'))
      || existsSync(join(projectRoot, 'pyproject.toml'));

    if (!looksValid) {
      // cwd doesn't have standard project indicators (.git, package.json, etc.)
      // detectProject may still find a valid project via git-root walk-up or fallback.
      // If cwd is a dangerous dir (home, system), it returns placeholder/<name> (degraded mode).
      const earlyDetect = detectProject(projectRoot);
      const isDegraded = earlyDetect.id.startsWith('placeholder/');

      if (!isDegraded) {
        // detectProject found a real project — use normal path (register tools before transport)
        console.error(`[memorix] detectProject succeeded without standard indicators`);
        const { server, projectId, deferredInit } = await createMemorixServer(projectRoot);
        const transport = new StdioServerTransport();
        await server.connect(transport);

        console.error(`[memorix] MCP Server running on stdio (project: ${projectId})`);
        console.error(`[memorix] Project root: ${projectRoot}`);
        deferredInit().catch(e => console.error(`[memorix] Deferred init error:`, e));
      } else {
        // Degraded cwd — try MCP roots protocol to discover the real project path.
        // Must connect transport first to send listRoots request.
        // Register a placeholder tool so tools/list returns 200 instead of -32601.
        console.error(`[memorix] cwd may not be a valid project, trying MCP roots protocol...`);
        const mcpServer = new McpServer({ name: 'memorix', version: '0.1.0' });

        mcpServer.registerTool('_memorix_loading', {
          description: 'Memorix is initializing, detecting project root...',
          inputSchema: {},
        }, async () => ({
          content: [{ type: 'text' as const, text: 'Memorix is still loading. Please retry shortly.' }],
        }));

        const transport = new StdioServerTransport();
        await mcpServer.connect(transport);

        try {
          const rootsResult = await Promise.race([
            mcpServer.server.listRoots(),
            new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
          ]);
          if (rootsResult && 'roots' in rootsResult && Array.isArray(rootsResult.roots) && rootsResult.roots.length > 0) {
            const rootUri = rootsResult.roots[0].uri;
            if (rootUri.startsWith('file://')) {
              const urlPath = decodeURIComponent(new URL(rootUri).pathname);
              const normalizedPath = process.platform === 'win32' && urlPath.match(/^\/[A-Za-z]:/)
                ? urlPath.slice(1) : urlPath;
              console.error(`[memorix] MCP client root: ${normalizedPath}`);
              projectRoot = normalizedPath;
            }
          }
        } catch {
          console.error(`[memorix] MCP roots not available (client may not support it)`);
        }

        // Register real tools — even if project detection is degraded,
        // the server starts and tools are usable. Never exit.
        const { projectId, deferredInit } = await createMemorixServer(projectRoot, mcpServer);
        console.error(`[memorix] MCP Server running on stdio (project: ${projectId})`);
        console.error(`[memorix] Project root: ${projectRoot}`);
        deferredInit().catch(e => console.error(`[memorix] Deferred init error:`, e));
      }
    } else {
      // Normal path: register tools FIRST, then connect transport.
      // This ensures tools/list returns all tools immediately on connect.
      // With fs-first detectProject (~1ms) + deferred hooks/sync, this completes
      // well within Codex's startup_timeout_sec (default 10s, recommended 30s).
      const { server, projectId, deferredInit } = await createMemorixServer(projectRoot);
      const transport = new StdioServerTransport();
      await server.connect(transport);

      console.error(`[memorix] MCP Server running on stdio (project: ${projectId})`);
      console.error(`[memorix] Project root: ${projectRoot}`);
      deferredInit().catch(e => console.error(`[memorix] Deferred init error:`, e));
    }
  },
});
