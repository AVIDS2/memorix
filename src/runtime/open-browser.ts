import { spawn } from 'node:child_process';

const LOCAL_HTTP_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function resolveLocalBrowserCommand(
  target: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  const url = new URL(target);
  if (url.protocol !== 'http:' || !LOCAL_HTTP_HOSTS.has(url.hostname) || !url.port || url.username || url.password) {
    throw new Error('Only unauthenticated loopback HTTP URLs can be opened automatically');
  }
  return platform === 'win32'
    ? { command: 'explorer.exe', args: [url.toString()] }
    : platform === 'darwin'
      ? { command: 'open', args: [url.toString()] }
      : { command: 'xdg-open', args: [url.toString()] };
}

export function openLocalBrowser(target: string): void {
  const { command, args } = resolveLocalBrowserCommand(target);
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', () => undefined);
  child.unref();
}
