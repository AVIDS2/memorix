/**
 * memorix serve — Start MCP Server on stdio
 */

import { defineCommand } from 'citty';
import { resolveToolProfile } from '../../server/tool-profile.js';
import { getMcpServerInfo } from '../../server/mcp-discovery.js';
import { StdioStartupGate } from '../../server/stdio-startup-gate.js';
import { mcpFileUriToPath } from '../mcp-root-path.js';

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
    // Take ownership of stdin before project/config/runtime initialization. The
    // gate answers handshake-free discovery and queues every other JSON-RPC line
    // until the SDK transport is connected, so cold starts cannot lose requests.
    const startupGate = new StdioStartupGate({
      stdin: process.stdin,
      stdout: process.stdout,
      serverInfo: getMcpServerInfo(),
      onError: (error) => {
        console.error(`[memorix] stdio startup gate error: ${error.message}`);
        // The stream is no longer safe to replay after an input-limit or I/O
        // failure. Exit instead of leaving a half-connected MCP process alive.
        process.exit(1);
      },
      onEnd: () => {
        console.error('[memorix] stdin closed — exiting');
        // The gate has already ended the transport input when ready. Set the
        // exit code and let pending JSON-RPC stdout writes drain naturally.
        process.exitCode = 0;
      },
    });
    startupGate.start();

    const { StdioServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/stdio.js'
    );
    const { createMemorixServer } = await import('../../server.js');
    const { detectProject, findGitInSubdirs, isSystemDirectory } = await import('../../project/detector.js');
    const { homedir } = await import('node:os');
    const { resolveServeProject } = await import('./serve-shared.js');

    // Priority: explicit --cwd arg > MEMORIX_PROJECT_ROOT env > INIT_CWD (npm lifecycle) > process.cwd()
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

    for (const message of resolution.messages) {
      console.error(message);
    }

    if (!resolution.detectedProject) {
      console.error(`[memorix] [WARN] ${resolution.error}`);
      console.error(`[memorix] Starting in deferred-binding mode — project will bind via MCP roots or memorix_session_start.`);
      console.error(`[memorix] For non-git directories, use --allow-untracked to enable untracked/ fallback.`);
      // Don't exit — allow deferred binding via session_start or MCP roots (fixes Cursor stdio #75)
    }

    const detected = resolution.detectedProject;
    const projectRoot = resolution.projectRoot;
    if (detected) {
      const { writeLastProjectRoot } = await import('../../project/launch-root.js');
      writeLastProjectRoot(detected.rootPath);
    }

    // Always register ALL tools BEFORE connecting transport.
    // This ensures tools/list returns the full tool set immediately on connect.
    // When no project detected, use deferred binding (allowUntrackedFallback=false, deferProjectInitUntilBound=true)
    const allowUntracked = args['allow-untracked'] ?? false;
    const toolProfile = resolveToolProfile({ explicit: args.mode, envValue: process.env.MEMORIX_MODE, fallback: 'micro' });
    const serverOptions = detected
      ? { toolProfile, deferProjectRuntimeInit: true }
      : { allowUntrackedFallback: allowUntracked, deferProjectInitUntilBound: !allowUntracked, deferProjectRuntimeInit: true, toolProfile };
    const { server, projectId, deferredInit, switchProject } = await createMemorixServer(projectRoot, undefined, undefined, serverOptions);
    const transport = new StdioServerTransport(startupGate.input, process.stdout);
    await server.connect(transport);
    startupGate.markReady();

    console.error(`[memorix] MCP Server running on stdio (project: ${projectId})`);
    console.error(`[memorix] Project root: ${detected?.rootPath ?? projectRoot}`);

    // ── MCP Roots Protocol ──────────────────────────────────────────
    // After connect, request workspace roots from the client (IDE).
    // This is the proper way to discover the user's workspace —
    // no --cwd needed if the IDE supports roots capability.
    const tryRootsSwitch = async () => {
      try {
        const { roots } = await server.server.listRoots();
        if (!roots || roots.length === 0) return;

        for (const root of roots) {
          if (!root.uri.startsWith('file://')) continue;
          const rootPath = mcpFileUriToPath(root.uri);
          if (!rootPath) continue;

          const rootDetected = detectProject(rootPath);
          if (rootDetected) {
            const switched = await switchProject(rootPath);
            if (switched) {
              console.error(`[memorix] [UPDATED] Project updated via MCP roots: ${rootDetected.id}`);
            }
            return; // use first valid root
          }
          // Root itself has no .git — try its subdirs
          const subGit = findGitInSubdirs(rootPath);
          if (subGit) {
            const switched = await switchProject(subGit);
            if (switched) {
              console.error(`[memorix] [UPDATED] Project updated via MCP roots (subdir): ${subGit}`);
            }
            return;
          }
        }
      } catch (err) {
        // Client doesn't support roots — that's OK, fall back to existing detection
        console.error(`[memorix] MCP roots not available (${(err as Error).message ?? 'unsupported'})`);
      }
    };

    // Do NOT proactively call listRoots() after connect — this violates MCP SEP-2260
    // which requires server-initiated requests to be associated with a client request.
    // Some clients (e.g. Codex) treat standalone roots/list as unexpected and may
    // fail to inject MCP tools. Instead, rely on:
    //   1. RootsListChangedNotification (client-initiated, then we respond)
    //   2. memorix_session_start({ projectRoot }) for explicit binding
    //   3. cwd-based detection as fallback (already done in deferred-binding)

    // Listen for roots changes (user switches workspace)
    try {
      const { RootsListChangedNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
      server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
        console.error(`[memorix] Roots changed — re-detecting project...`);
        await tryRootsSwitch();
      });
    } catch { /* notification handler setup is optional */ }

    const deferredInitTimer = setTimeout(() => {
      deferredInit().catch(e => console.error(`[memorix] Deferred init error:`, e));
    }, 5_000);
    deferredInitTimer.unref?.();
    // Fire-and-forget: background update check. Default is notify-only.
    import('../update-checker.js').then(m => m.checkForUpdates()).catch(() => {});
  },
});
