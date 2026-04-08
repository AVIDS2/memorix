#!/usr/bin/env node

/**
 * Memorix — Cross-Agent Memory Bridge
 *
 * Entry point for the MCP Server.
 * Connects via stdio transport for compatibility with all MCP-supporting agents.
 *
 * Usage:
 *   node dist/index.js          # Start as MCP server (stdio)
 *   memorix init                # CLI: Initialize project (P1)
 *   memorix sync                # CLI: Sync rules across agents (P2)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMemorixServer } from './server.js';

async function main(): Promise<void> {
  const { homedir } = await import('node:os');
  const { existsSync, readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const { detectProject, findGitInSubdirs, isSystemDirectory } = await import('./project/detector.js');
  const { resolveServeProject } = await import('./cli/commands/serve-shared.js');

  let safeCwd: string;
  try { safeCwd = process.cwd(); } catch { safeCwd = homedir(); }

  const lastRootFile = path.join(homedir(), '.memorix', 'last-project-root');
  let lastKnownProjectRoot: string | undefined;
  if (existsSync(lastRootFile)) {
    try {
      const lastRoot = readFileSync(lastRootFile, 'utf-8').trim();
      if (lastRoot && existsSync(lastRoot)) {
        lastKnownProjectRoot = lastRoot;
      }
    } catch { /* ignore */ }
  }

  const resolution = resolveServeProject(
    {
      processCwd: safeCwd,
      homeDir: homedir(),
      lastKnownProjectRoot,
    },
    { detectProject, findGitInSubdirs, isSystemDirectory },
  );

  for (const message of resolution.messages) {
    console.error(message);
  }

  if (!resolution.detectedProject) {
    throw new Error(resolution.error);
  }

  const { server, projectId, deferredInit } = await createMemorixServer(resolution.projectRoot);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[memorix] MCP Server running on stdio (project: ${projectId})`);
  deferredInit().catch(e => console.error(`[memorix] Deferred init error:`, e));
}

main().catch((error) => {
  console.error('[memorix] Fatal error:', error);
  process.exit(1);
});
