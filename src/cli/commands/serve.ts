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

    // Priority: explicit --cwd arg > MEMORIX_PROJECT_ROOT env > INIT_CWD (npm lifecycle) > process.cwd()
    let safeCwd: string;
    try { safeCwd = process.cwd(); } catch { safeCwd = (await import('node:os')).homedir(); }
    let projectRoot = args.cwd || process.env.MEMORIX_PROJECT_ROOT || process.env.INIT_CWD || safeCwd;

    console.error(`[memorix] Starting with cwd: ${projectRoot}`);

    // Check if cwd-based detection would fail (e.g., IDE sets cwd to its install dir)
    // Only truly invalid projects need MCP roots resolution.
    // local/<dirname> projects are perfectly valid — they must NOT enter the roots flow,
    // because that flow connects the server before registering tools, causing
    // tools/list -> "Method not found" (capabilities declared without tools).
    const earlyDetect = detectProject(projectRoot);
    const needsRoots = earlyDetect.id === '__invalid__';

    if (needsRoots) {
      // cwd is not a valid project — try MCP roots protocol to get IDE workspace path
      console.error(`[memorix] cwd is not a valid project, trying MCP roots protocol...`);
      const mcpServer = new McpServer({ name: 'memorix', version: '0.1.0' });
      const transport = new StdioServerTransport();
      await mcpServer.connect(transport);

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

      if (!rootResolved && earlyDetect.id === '__invalid__') {
        // No roots and cwd is invalid — cannot proceed
        console.error(`[memorix] ERROR: Could not detect a valid project.`);
        console.error(`[memorix] Fix: set --cwd or MEMORIX_PROJECT_ROOT, or use an IDE that supports MCP roots.`);
        process.exit(1);
      }

      // Initialize tools on the already-connected server
      const { projectId } = await createMemorixServer(projectRoot, mcpServer);
      console.error(`[memorix] MCP Server running on stdio (project: ${projectId})`);
      console.error(`[memorix] Project root: ${projectRoot}`);
    } else {
      // Normal flow: cwd is a valid project
      const { server, projectId } = await createMemorixServer(projectRoot);
      const transport = new StdioServerTransport();
      await server.connect(transport);

      console.error(`[memorix] MCP Server running on stdio (project: ${projectId})`);
      console.error(`[memorix] Project root: ${projectRoot}`);
    }
  },
});
