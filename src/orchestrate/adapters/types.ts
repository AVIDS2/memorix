/**
 * Agent Adapter types — Phase 4c spawn + handle model.
 *
 * Each agent CLI adapter implements this interface.
 * spawn() returns a process handle immediately (NOT exec + string).
 * Bounded memory via RingBuffer. Cancellation via abort().
 */

export interface AgentProcess {
  /** Underlying child process PID */
  pid: number;

  /** Resolves when process exits */
  completion: Promise<AgentProcessResult>;

  /** Abort the process (SIGTERM, then SIGKILL after grace period) */
  abort(): void;
}

export interface AgentProcessResult {
  exitCode: number | null;
  signal: string | null;
  /** Last N lines of combined stdout+stderr (ring buffer, not full capture) */
  tailOutput: string;
  /** Whether the process was killed by timeout or abort */
  killed: boolean;
}

export interface SpawnOptions {
  cwd: string;
  env?: Record<string, string>;
  /** Per-task timeout in ms (default: 600_000 = 10 min) */
  timeoutMs?: number;
  /** Ring buffer size in lines (default: 50) */
  tailLines?: number;
}

export interface AgentAdapter {
  /** Adapter display name (e.g. 'claude', 'codex', 'gemini') */
  name: string;

  /** Check if the CLI tool is installed and accessible */
  available(): Promise<boolean>;

  /** Spawn agent process — returns handle immediately, does NOT wait for completion */
  spawn(prompt: string, opts: SpawnOptions): AgentProcess;
}
