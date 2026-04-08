/**
 * Memorix TUI entry point.
 *
 * Renders the Ink-based workbench in alternate screen buffer.
 * All commands are now Ink-native — no interactive fallback needed.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const ALT_ON = '\x1b[?1049h\x1b[?25l';
const ALT_OFF = '\x1b[?25h\x1b[?1049l';

/**
 * Start the fullscreen Ink-based workbench.
 * All views are Ink-native. No alternate-screen exit/re-enter loop.
 */
export async function startWorkbench(): Promise<void> {
  const { render } = await import('ink');
  const React = await import('react');
  const { WorkbenchApp } = await import('./App.js');

  process.stdout.write(ALT_ON);

  const app = React.createElement(WorkbenchApp, {
    version: pkg.version,
    onExitForInteractive: () => {
      // No-op: all commands are now Ink-native.
      // Kept for interface compatibility but never called.
    },
  });

  const instance = render(app, { exitOnCtrlC: false });

  try {
    await instance.waitUntilExit();
  } catch {
    // Ignore unmount-triggered exits.
  }

  process.stdout.write(ALT_OFF);
}
