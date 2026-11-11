export interface CliInteractivity {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}

/**
 * MCP hosts start package commands with piped stdio, while a human terminal
 * has TTYs on both streams. Keep the friendly memcode default for humans and
 * make the package safe for registry probes and generic MCP launchers.
 */
export function shouldDefaultToMcp(options: CliInteractivity = {}): boolean {
  const stdinIsTTY = options.stdinIsTTY ?? process.stdin.isTTY;
  const stdoutIsTTY = options.stdoutIsTTY ?? process.stdout.isTTY;
  return stdinIsTTY !== true || stdoutIsTTY !== true;
}
