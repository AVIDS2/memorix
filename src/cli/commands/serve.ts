/**
 * memorix serve - Start MCP Server on stdio transport.
 *
 * The official MCP v2 stdio entry owns modern discovery, per-request metadata,
 * legacy compatibility, and protocol lifecycle. Memorix keeps its startup
 * gate in front of that entry so early claim-less discovery remains compatible
 * with clients shipped before the 2026 protocol revision.
 */

import { defineCommand } from 'citty';
import { resolveToolProfile } from '../../server/tool-profile.js';
import { getMcpServerInfo } from '../../server/mcp-discovery.js';
import { StdioStartupGate } from '../../server/stdio-startup-gate.js';
import { mcpFileUriToPath } from '../mcp-root-path.js';
import type { ModernMcpBridge } from '../../server/modern-mcp-bridge.js';

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
    'allow-untracked': {
      type: 'boolean',
      description: 'Allow non-git directories as untracked/ projects (default: false)',
      default: false,
    },
    mode: {
      type: 'string',
      description: 'Tool profile to expose (micro, lite, team, full; default: micro; coordination join remains explicit)',
      required: false,
    },
  },
  run: async ({ args }) => {
    const { serveStdio, StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
    const { createModernMcpBridge } = await import('../../server/modern-mcp-bridge.js');
    const { detectProject, findGitInSubdirs, isSystemDirectory } = await import('../../project/detector.js');
    const { homedir } = await import('node:os');
    const { writeLastProjectRoot } = await import('../../project/launch-root.js');
    const { resolveServeProject } = await import('./serve-shared.js');

    // Take ownership of stdin before project/config/runtime initialization.
    // The gate answers the old claim-less discover probe and queues every
    // other line until the official v2 transport is listening.
    let stdioHandle: { close: () => Promise<void> } | undefined;
    let stdinEndedBeforeHandle = false;
    const startupGate = new StdioStartupGate({
      stdin: process.stdin,
      stdout: process.stdout,
      serverInfo: getMcpServerInfo(),
      onError: (error) => {
        console.error(`[memorix] stdio startup gate error: ${error.message}`);
        process.exit(1);
      },
      onEnd: () => {
        console.error('[memorix] stdin closed - exiting');
        if (stdioHandle) {
          void stdioHandle.close().catch((error) => {
            console.error(`[memorix] stdio close error: ${error instanceof Error ? error.message : String(error)}`);
          });
        } else {
          stdinEndedBeforeHandle = true;
        }
      },
    });
    startupGate.start();

    // Priority: explicit --cwd arg > MEMORIX_PROJECT_ROOT > INIT_CWD > process.cwd().
    let safeCwd: string;
    try { safeCwd = process.cwd(); } catch { safeCwd = homedir(); }
    const resolution = resolveServeProject(
      {
        cwdArg: args.cwd,
        envProjectRoot: process.env.MEMORIX_PROJECT_ROOT,
        initCwd: process.env.INIT_CWD,
        processCwd: safeCwd,
        homeDir: homedir(),
      },
      { detectProject, findGitInSubdirs, isSystemDirectory },
    );
    for (const message of resolution.messages) console.error(message);

    if (!resolution.detectedProject) {
      console.error(`[memorix] [WARN] ${resolution.error}`);
      console.error('[memorix] Starting in deferred-binding mode - bind with memorix_session_start(projectRoot=...) when needed.');
      console.error('[memorix] For non-git directories, use --allow-untracked to enable untracked/ fallback.');
    }

    const detected = resolution.detectedProject;
    const projectRoot = resolution.projectRoot;
    if (detected) writeLastProjectRoot(detected.rootPath);

    const allowUntracked = args['allow-untracked'] ?? false;
    const toolProfile = resolveToolProfile({
      explicit: args.mode,
      envValue: process.env.MEMORIX_MODE,
      fallback: 'micro',
    });

    const transport = new StdioServerTransport(startupGate.input, process.stdout);
    const createBridge = async (): Promise<ModernMcpBridge> => {
      const bridge = await createModernMcpBridge({
        projectRoot,
        allowUntrackedFallback: allowUntracked,
        deferProjectInitUntilBound: !allowUntracked,
        deferProjectRuntimeInit: true,
        toolProfile,
      });

      const tryRootsSwitch = async (): Promise<void> => {
        try {
          if (bridge.memorix.isExplicitlyBound()) return;
          const { roots } = await bridge.server.listRoots();
          for (const root of roots ?? []) {
            if (!root.uri.startsWith('file://')) continue;
            const rootPath = mcpFileUriToPath(root.uri);
            if (!rootPath) continue;

            const switched = await bridge.memorix.switchProject(rootPath, 'mcp-roots');
            if (switched) {
              console.error(`[memorix] [UPDATED] Project updated via MCP roots: ${rootPath}`);
              return;
            }
            const subGit = findGitInSubdirs(rootPath);
            if (subGit && await bridge.memorix.switchProject(subGit, 'mcp-roots')) {
              console.error(`[memorix] [UPDATED] Project updated via MCP roots (subdir): ${subGit}`);
              return;
            }
          }
        } catch (error) {
          console.error(`[memorix] MCP roots not available (${error instanceof Error ? error.message : 'unsupported'})`);
        }
      };

      // roots/list is a legacy-era request. The v2 SDK rejects it on the
      // modern era, while retaining this handler keeps existing IDE clients.
      bridge.server.setNotificationHandler('notifications/roots/list_changed', async () => {
        await tryRootsSwitch();
      });

      const deferredInitTimer = setTimeout(() => {
        bridge.memorix.deferredInit().catch((error) => {
          console.error(`[memorix] Deferred init error: ${error instanceof Error ? error.message : String(error)}`);
        });
      }, 5_000);
      deferredInitTimer.unref?.();

      const originalClose = bridge.close.bind(bridge);
      bridge.close = async () => {
        clearTimeout(deferredInitTimer);
        await originalClose();
      };
      return bridge;
    };

    stdioHandle = serveStdio(createBridge, {
      transport,
      legacy: 'serve',
      onerror: (error) => console.error(`[memorix] stdio MCP error: ${error.message}`),
    });
    startupGate.markReady();
    if (stdinEndedBeforeHandle) {
      void stdioHandle.close().catch((error) => {
        console.error(`[memorix] stdio close error: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    console.error(`[memorix] MCP Server running on stdio (profile: ${toolProfile}, project: ${detected?.id ?? 'deferred'})`);
    console.error(`[memorix] Project root: ${detected?.rootPath ?? projectRoot}`);
    import('../update-checker.js').then(m => m.checkForUpdates()).catch(() => {});
  },
});
