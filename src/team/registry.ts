/**
 * Agent Registry — Tracks agents in orchestration coordination state
 *
 * In-memory registry shared across all MCP sessions on the same HTTP server.
 * Each agent joins with a name, optional role, and capabilities.
 * Registry supports heartbeat for liveness detection.
 */

import { randomUUID } from 'node:crypto';

// ─── Types ───────────────────────────────────────────────────────────

export interface AgentJoinInput {
  name: string;
  role?: string;
  capabilities?: string[];
}

export interface AgentInfo {
  id: string;
  name: string;
  role?: string;
  capabilities: string[];
  status: 'active' | 'inactive';
  joinedAt: Date;
  lastSeenAt: Date;
  leftAt?: Date;
}

export interface AgentListFilter {
  status?: 'active' | 'inactive';
}

// ─── Registry ────────────────────────────────────────────────────────

export class AgentRegistry {
  private agents = new Map<string, AgentInfo>();
  private nameIndex = new Map<string, string>(); // name → id

  /**
   * Register an agent. If an agent with the same name already exists,
   * reactivate it with updated info instead of creating a duplicate.
   */
  join(input: AgentJoinInput): AgentInfo {
    const existing = this.nameIndex.get(input.name);
    if (existing) {
      const agent = this.agents.get(existing)!;
      agent.role = input.role;
      agent.capabilities = input.capabilities ?? agent.capabilities;
      agent.status = 'active';
      agent.lastSeenAt = new Date();
      delete agent.leftAt;
      return { ...agent };
    }

    const id = randomUUID();
    const now = new Date();
    const agent: AgentInfo = {
      id,
      name: input.name,
      role: input.role,
      capabilities: input.capabilities ?? [],
      status: 'active',
      joinedAt: now,
      lastSeenAt: now,
    };

    this.agents.set(id, agent);
    this.nameIndex.set(input.name, id);
    return { ...agent };
  }

  /**
   * Mark an agent as inactive. Returns false if agent not found.
   */
  leave(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.status = 'inactive';
    agent.leftAt = new Date();
    return true;
  }

  /**
   * Get info for a specific agent. Returns null if not found.
   */
  getAgent(agentId: string): AgentInfo | null {
    const agent = this.agents.get(agentId);
    return agent ? { ...agent } : null;
  }

  /**
   * List agents, optionally filtered by status.
   */
  listAgents(filter?: AgentListFilter): AgentInfo[] {
    const all = [...this.agents.values()];
    if (filter?.status) {
      return all.filter(a => a.status === filter.status).map(a => ({ ...a }));
    }
    return all.map(a => ({ ...a }));
  }

  /**
   * Update lastSeenAt for an agent. Returns false if not found.
   */
  heartbeat(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.lastSeenAt = new Date();
    return true;
  }

  /**
   * Count of currently active agents.
   */
  getActiveCount(): number {
    let count = 0;
    for (const agent of this.agents.values()) {
      if (agent.status === 'active') count++;
    }
    return count;
  }

  /** Serialize state for file persistence */
  serialize(): { agents: Record<string, unknown>; nameIndex: Record<string, string> } {
    const agents: Record<string, unknown> = {};
    for (const [id, a] of this.agents) {
      agents[id] = {
        ...a,
        joinedAt: a.joinedAt.toISOString(),
        lastSeenAt: a.lastSeenAt.toISOString(),
        leftAt: a.leftAt?.toISOString() ?? null,
      };
    }
    return { agents, nameIndex: Object.fromEntries(this.nameIndex) };
  }

  /** Hydrate state from file persistence */
  hydrate(data: { agents?: Record<string, any>; nameIndex?: Record<string, string> }): void {
    this.agents.clear();
    this.nameIndex.clear();
    if (!data?.agents) return;
    for (const [id, raw] of Object.entries(data.agents)) {
      this.agents.set(id, {
        ...raw,
        joinedAt: new Date(raw.joinedAt),
        lastSeenAt: new Date(raw.lastSeenAt),
        leftAt: raw.leftAt ? new Date(raw.leftAt) : undefined,
      });
    }
    if (data.nameIndex) {
      for (const [name, id] of Object.entries(data.nameIndex)) {
        this.nameIndex.set(name, id);
      }
    }
  }
}
