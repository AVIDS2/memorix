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

    // ALWAYS connect transport first — MCP handshake must complete within the client's
    // startup timeout (Codex default: 10s). All heavy work (git, data loading, reindex)
    // happens AFTER the connection is established.
    const mcpServer = new McpServer({ name: 'memorix', version: '0.1.0' });
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error(`[memorix] Transport connected, initializing...`);

    // Lightweight check: does this look like a valid project directory?
    // Avoids calling detectProject (which runs slow git commands) for the fast path.
    const looksValid = existsSync(join(projectRoot, '.git'))
      || existsSync(join(projectRoot, 'package.json'))
      || existsSync(join(projectRoot, 'Cargo.toml'))
      || existsSync(join(projectRoot, 'go.mod'))
      || existsSync(join(projectRoot, 'pyproject.toml'));

    if (!looksValid) {
      // cwd might not be a project — try MCP roots protocol to get IDE workspace path
      console.error(`[memorix] cwd may not be a valid project, trying MCP roots protocol...`);

      let rootResolved = false;
      try {
        const rootsResult = await Promise.race([
          mcpServer.server.listRoots(),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
        if (rootsResult && 'roots' in rootsResult && Array.isArray(rootsResult.roots) && rootsResult.roots.length > 0) {
          const rootUri = rootsResult.roots[0].uri;
          if (rootUri.startsWith('file://')) {
            const urlPath = decodeURIComponent(new URL(rootUri).pathname);
            // On Windows, URL.pathname has a leading / (e.g., /C:/path) — remove it
            const normalizedPath = process.platform === 'win32' && urlPath.match(/^\/[A-Za-z]:/)
              ? urlPath.slice(1) : urlPath;
            console.error(`[memorix] MCP client root: ${normalizedPath}`);
            projectRoot = normalizedPath;
            rootResolved = true;
          }
        }
      } catch {
        console.error(`[memorix] MCP roots not available (client may not support it)`);
      }

      // Full validation with detectProject (may call git — but transport already connected)
      if (!rootResolved) {
        const earlyDetect = detectProject(projectRoot);
        if (earlyDetect.id === '__invalid__') {
          console.error(`[memorix] ERROR: Could not detect a valid project.`);
          console.error(`[memorix] Fix: set --cwd or MEMORIX_PROJECT_ROOT, or use an IDE that supports MCP roots.`);
          process.exit(1);
        }
      }
    }

    // Initialize: register tools on the already-connected server
    const { projectId, deferredInit } = await createMemorixServer(projectRoot, mcpServer);
    console.error(`[memorix] MCP Server running on stdio (project: ${projectId})`);
    console.error(`[memorix] Project root: ${projectRoot}`);
    // Background: hooks, sync scan, file watcher (non-blocking)
    deferredInit().catch(e => console.error(`[memorix] Deferred init error:`, e));
  },
});
