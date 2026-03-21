/**
 * Memorix TUI entry point.
 *
 * Renders the Ink-based workbench, manages the alternate screen buffer,
 * handles the remaining interactive-command fallback, and exits cleanly.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// At runtime, bundled code lives at dist/cli/index.js, two levels from root.
const pkg = require('../../package.json') as { version: string };

// ANSI escape sequences for alternate screen.
const ALT_ON = '\x1b[?1049h\x1b[?25l';
const ALT_OFF = '\x1b[?25h\x1b[?1049l';

/**
 * Start the fullscreen Ink-based workbench.
 * Exported as `startWorkbench` so the CLI entry can call it.
 */
export async function startWorkbench(): Promise<void> {
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
        // Unmount Ink so any remaining external prompt flow can take over stdin/stdout.
        instance?.unmount();
      },
    });

    instance = render(app, {
      exitOnCtrlC: false,
    });
  };

  const exitTUI = () => {
    process.stdout.write(ALT_OFF);
  };

  // Main loop: Ink -> optional interactive command -> Ink -> ...
  while (true) {
    pendingInteractiveCmd = null;
    enterTUI();

    try {
      await instance!.waitUntilExit();
    } catch {
      // Ignore unmount-triggered exits.
    }

    exitTUI();

    if (pendingInteractiveCmd) {
      await runInteractiveCommand(pendingInteractiveCmd);
      continue;
    }

    break;
  }
}

/**
 * Run an interactive command outside of Ink.
 * The terminal is in normal mode here (not alternate screen).
 */
async function runInteractiveCommand(cmd: string): Promise<void> {
  try {
    switch (cmd) {
      case '/configure':
      case '/config': {
        const indexModule = await import('../index.js');
        if (typeof (indexModule as { runConfigureStandalone?: () => Promise<void> }).runConfigureStandalone === 'function') {
          await (indexModule as { runConfigureStandalone: () => Promise<void> }).runConfigureStandalone();
        } else {
          console.log('\nOpening configuration...\n');
          const { runConfigureInline } = await import('./interactive-commands.js');
          await runConfigureInline();
        }
        break;
      }

      // /cleanup, /ingest, and /integrate are Ink-native views handled in App.tsx.
      default:
        console.log(`Unknown interactive command: ${cmd}`);
    }
  } catch (err) {
    console.error(`Command failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log('\nPress Enter to return to workbench...');
  await new Promise<void>((resolve) => {
    const onData = () => {
      process.stdin.removeListener('data', onData);
      resolve();
    };

    process.stdin.once('data', onData);
    setTimeout(() => {
      process.stdin.removeListener('data', onData);
      resolve();
    }, 30000);
  });
}
