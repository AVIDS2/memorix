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
    const { detectProject, findGitInSubdirs } = await import('../../project/detector.js');

    // Auto-exit when stdio pipe breaks (IDE closed) to prevent orphaned processes
    process.stdin.on('end', () => {
      console.error('[memorix] stdin closed — exiting');
      process.exit(0);
    });

    // Priority: explicit --cwd arg > MEMORIX_PROJECT_ROOT env > INIT_CWD (npm lifecycle) > process.cwd()
    let safeCwd: string;
    try { safeCwd = process.cwd(); } catch { safeCwd = (await import('node:os')).homedir(); }
    let projectRoot = args.cwd || process.env.MEMORIX_PROJECT_ROOT || process.env.INIT_CWD || safeCwd;

    console.error(`[memorix] Starting with cwd: ${projectRoot}`);

    // Strict .git detection — no .git = not a project
    let detected = detectProject(projectRoot);

    // Multi-project workspace: cwd has no .git, scan immediate subdirs
    if (!detected) {
      const subGit = findGitInSubdirs(projectRoot);
      if (subGit) {
        console.error(`[memorix] Found .git in subdirectory: ${subGit}`);
        projectRoot = subGit;
        detected = detectProject(subGit);
      }
    }

    if (detected) {
      // .git found — fast path: register tools FIRST, then connect transport.
      // This ensures tools/list returns all tools immediately on connect.
      const { server, projectId, deferredInit } = await createMemorixServer(projectRoot);
      const transport = new StdioServerTransport();
      await server.connect(transport);

      console.error(`[memorix] MCP Server running on stdio (project: ${projectId})`);
      console.error(`[memorix] Project root: ${detected.rootPath}`);
      deferredInit().catch(e => console.error(`[memorix] Deferred init error:`, e));
      import('../update-checker.js').then(m => m.checkForUpdates()).catch(() => {});
    } else {
      // No .git — try MCP roots protocol to discover the real project path.
      // Must connect transport first to send listRoots request.
      console.error(`[memorix] No .git found, trying MCP roots protocol...`);
      const mcpServer = new McpServer({ name: 'memorix', version: typeof __MEMORIX_VERSION__ !== 'undefined' ? __MEMORIX_VERSION__ : '1.0.1' });

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

      // Register real tools — createMemorixServer handles no-.git gracefully
      const { projectId, deferredInit } = await createMemorixServer(projectRoot, mcpServer);
      console.error(`[memorix] MCP Server running on stdio (project: ${projectId})`);
      console.error(`[memorix] Project root: ${projectRoot}`);
      deferredInit().catch(e => console.error(`[memorix] Deferred init error:`, e));
      import('../update-checker.js').then(m => m.checkForUpdates()).catch(() => {});
    }
  },
});
