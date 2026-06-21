/**
 * Terminal shells often close stdout early when users pipe output into tools
 * such as `head` or `Select-Object -First`. Treat that as a normal CLI exit,
 * not as an application crash.
 */
export function isBrokenPipeError(err: unknown): boolean {
  return Boolean(
    err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: unknown }).code === 'EPIPE',
  );
}

export function installCliPipeErrorGuard(): void {
  const handleStreamError = (err: unknown) => {
    if (isBrokenPipeError(err)) {
      process.exit(0);
    }
    throw err;
  };

  process.stdout.on('error', handleStreamError);
  process.stderr.on('error', handleStreamError);
}
