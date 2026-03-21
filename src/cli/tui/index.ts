/**
 * Memorix TUI Entry Point
 *
 * Renders the Ink-based workbench. Handles alternate screen buffer,
 * interactive command fallback (exit Ink → run @clack/prompts → re-enter Ink),
 * and clean exit.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// At runtime, bundled code lives at dist/cli/index.js — 2 levels from root
const pkg = require('../../package.json') as { version: string };

// ANSI escape sequences for alternate screen
const ALT_ON  = '\x1b[?1049h\x1b[?25l';
const ALT_OFF = '\x1b[?25h\x1b[?1049l';

/**
 * Start the fullscreen Ink-based workbench.
 * Exported as `startWorkbench` so the CLI entry can call it.
 */
export async function startWorkbench(): Promise<void> {
  // Dynamically import Ink + React to keep the module boundary clean
  const { render } = await import('ink');
  const React = await import('react');
  const { WorkbenchApp } = await import('./App.js');

  let pendingInteractiveCmd: string | null = null;
  let instance: ReturnType<typeof render> | null = null;

  const enterTUI = () => {
    process.stdout.write(ALT_ON);

    const app = React.createElement(WorkbenchApp, {
      version: pkg.version,
      onExitForInteractive: (cmd: string) => {
        pendingInteractiveCmd = cmd;
        // Unmount Ink so @clack/prompts can take over stdin/stdout
        instance?.unmount();
      },
    });

    instance = render(app, {
      exitOnCtrlC: false, // We handle Ctrl+C ourselves in CommandBar
    });
  };

  const exitTUI = () => {
    process.stdout.write(ALT_OFF);
  };

  // Main loop: Ink → (optional interactive command) → Ink → ...
  while (true) {
    pendingInteractiveCmd = null;
    enterTUI();

    try {
      await instance!.waitUntilExit();
    } catch { /* unmounted */ }

    exitTUI();

    // If there's a pending interactive command, run it outside of Ink
    if (pendingInteractiveCmd) {
      await runInteractiveCommand(pendingInteractiveCmd);
      // After the interactive command finishes, re-enter the TUI
      continue;
    }

    // Normal exit (user typed /exit or Ctrl+C)
    break;
  }
}

/**
 * Run an interactive @clack/prompts command outside of Ink.
 * The terminal is in normal mode here (not alternate screen).
 */
async function runInteractiveCommand(cmd: string): Promise<void> {
  try {
    switch (cmd) {
      case '/configure':
      case '/config': {
        // Import the configure logic from the main CLI index
        // We need to call runConfigure() which is defined in index.ts
        // For now, dynamically import and run the configure flow
        const indexModule = await import('../index.js');
        if (typeof (indexModule as any).runConfigureStandalone === 'function') {
          await (indexModule as any).runConfigureStandalone();
        } else {
          // Fallback: run directly
          console.log('\nOpening configuration...\n');
          const { runConfigureInline } = await import('./interactive-commands.js');
          await runConfigureInline();
        }
        break;
      }

      case '/integrate':
      case '/setup': {
        const m = await import('../commands/integrate.js');
        await m.default.run?.({ args: { _: [] }, rawArgs: [], cmd: m.default } as any);
        break;
      }

      case '/cleanup': {
        const { runCleanupInline } = await import('./interactive-commands.js');
        await runCleanupInline();
        break;
      }

      case '/ingest': {
        const { runIngestInline } = await import('./interactive-commands.js');
        await runIngestInline();
        break;
      }

      default:
        console.log(`Unknown interactive command: ${cmd}`);
    }
  } catch (err) {
    console.error(`Command failed: ${err instanceof Error ? err.message : err}`);
  }

  // Brief pause so user can see output before TUI re-enters
  console.log('\nPress Enter to return to workbench...');
  await new Promise<void>((resolve) => {
    const onData = () => {
      process.stdin.removeListener('data', onData);
      resolve();
    };
    process.stdin.once('data', onData);
    // Auto-return after 30s
    setTimeout(() => {
      process.stdin.removeListener('data', onData);
      resolve();
    }, 30000);
  });
}
