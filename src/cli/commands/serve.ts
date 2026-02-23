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
    const { createMemorixServer } = await import('../../server.js');

    // Priority: explicit --cwd arg > MEMORIX_PROJECT_ROOT env > INIT_CWD (npm lifecycle) > process.cwd()
    const projectRoot = args.cwd || process.env.MEMORIX_PROJECT_ROOT || process.env.INIT_CWD || process.cwd();

    // NOTE: We intentionally do NOT fall back to the script's own directory.
    // That fallback caused wrong project detection (e.g., detecting memorix's
    // own repo instead of the user's project) when the IDE doesn't set cwd.
    // detectProject() in detector.ts already has proper fallback logic.

    console.error(`[memorix] Starting with cwd: ${projectRoot}`);

    const { server, projectId } = await createMemorixServer(projectRoot);
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error(`[memorix] MCP Server running on stdio (project: ${projectId})`);
    console.error(`[memorix] Project root: ${projectRoot}`);
  },
});
