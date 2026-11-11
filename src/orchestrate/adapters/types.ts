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

  /** Streaming messages from the agent process (if supported by the adapter) */
  messages?: AsyncIterable<AgentMessage>;
}

export type AgentMessageType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error' | 'status';

export interface AgentMessage {
  type: AgentMessageType;
  content?: string;
  tool?: string;
  callId?: string;
  input?: Record<string, unknown>;
  output?: string;
  /** Token usage snapshot (cumulative, present on 'assistant' messages from Claude) */
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model?: string;
}

export interface AgentProcessResult {
  exitCode: number | null;
  signal: string | null;
  /** Last N lines of combined stdout+stderr (ring buffer, not full capture) */
  tailOutput: string;
  /** Whether the process was killed by timeout or abort */
  killed: boolean;
  /** Accumulated token usage per model (populated by streaming adapters) */
  tokenUsage?: Record<string, TokenUsage>;
  /** Session ID (populated by Claude stream-json adapter for session reuse) */
  sessionId?: string;
}

export interface SpawnOptions {
  cwd: string;
  env?: Record<string, string>;
  /** Per-task timeout in ms (default: 600_000 = 10 min) */
  timeoutMs?: number;
  /** Ring buffer size in lines (default: 50) */
  tailLines?: number;
  /** Resume a previous agent session (supported by Claude --resume) */
  resumeSessionId?: string;
}

export interface AgentAdapter {
  /** Adapter display name (e.g. 'claude', 'codex', 'gemini') */
  name: string;

  /** Check if the CLI tool is installed and accessible */
  available(): Promise<boolean>;

  /** Spawn agent process — returns handle immediately, does NOT wait for completion */
  spawn(prompt: string, opts: SpawnOptions): AgentProcess;
}
