export function parseTcpPort(value: string | undefined, defaultPort: number): number {
  const raw = value?.trim() || String(defaultPort);
  if (!/^[0-9]+$/u.test(raw)) {
    throw new Error('Port must be a whole number between 1 and 65535.');
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Port must be a whole number between 1 and 65535.');
  }
  return port;
}

/**
 * Command handlers should report malformed user input without delegating an
 * expected validation error to the CLI framework, which would print a stack.
 */
export function parseTcpPortOrReport(
  value: string | undefined,
  defaultPort: number,
  report: (message: string) => void = (message) => console.error(message),
): number | undefined {
  try {
    return parseTcpPort(value, defaultPort);
  } catch (error) {
    report(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}
