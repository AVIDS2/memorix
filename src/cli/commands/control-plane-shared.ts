import { execSync } from 'node:child_process';

export const CONTROL_PLANE_HEALTH_PATH = '/api/team';

export async function checkControlPlaneHealth(
  port: number,
  timeoutMs = 3000,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${port}${CONTROL_PLANE_HEALTH_PATH}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export function isLikelyMemorixServeHttpCommand(command: string): boolean {
  return command.includes('memorix') && command.includes('serve-http');
}

export function isMemorixBackgroundProcess(pid: number, readProcessCommand = readProcessCommandForPid): boolean {
  try {
    const command = readProcessCommand(pid);
    return isLikelyMemorixServeHttpCommand(command);
  } catch {
    return false;
  }
}

export function readProcessCommandForPid(pid: number): string {
  if (process.platform === 'linux') {
    return execSync(`tr '\0' ' ' < /proc/${pid}/cmdline`, { encoding: 'utf-8' }).trim();
  }
  return execSync(`ps -p ${pid} -o command=`, { encoding: 'utf-8' }).trim();
}
