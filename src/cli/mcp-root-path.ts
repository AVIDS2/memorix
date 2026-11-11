import path from 'node:path';

/**
 * Convert an MCP file URI to a path for the host platform. MCP Roots always
 * use file URIs; replacing slashes unconditionally corrupts POSIX roots.
 */
export function mcpFileUriToPath(uri: string, platform: NodeJS.Platform = process.platform): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'file:') return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }

  const hostname = parsed.hostname;
  if (platform === 'win32') {
    if (hostname && hostname !== 'localhost') {
      return path.win32.normalize(`\\\\${hostname}${pathname.replace(/\//g, '\\')}`);
    }
    if (/^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1);
    return path.win32.normalize(pathname.replace(/\//g, '\\'));
  }

  if (hostname && hostname !== 'localhost') {
    return path.posix.normalize(`//${hostname}${pathname}`);
  }
  return path.posix.normalize(pathname);
}
