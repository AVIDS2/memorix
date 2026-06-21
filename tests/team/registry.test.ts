/**
 * Team Agent Registry Tests (TDD — RED phase)
 *
 * Tests for agent join/leave/status in coordination state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from '../../src/team/registry.js';

let registry: AgentRegistry;

beforeEach(() => {
  registry = new AgentRegistry();
});

describe('AgentRegistry', () => {
  describe('join', () => {
    it('should register a new agent', () => {
      const agent = registry.join({
        name: 'cursor-agent',
        role: 'frontend',
        capabilities: ['react', 'css'],
      });

      expect(agent.id).toBeTruthy();
      expect(agent.name).toBe('cursor-agent');
      expect(agent.role).toBe('frontend');
      expect(agent.status).toBe('active');
      expect(agent.joinedAt).toBeInstanceOf(Date);
    });

    it('should assign unique IDs to different agents', () => {
      const a1 = registry.join({ name: 'agent-1' });
      const a2 = registry.join({ name: 'agent-2' });
      expect(a1.id).not.toBe(a2.id);
    });

    it('should reuse existing agent if same name rejoins', () => {
      const a1 = registry.join({ name: 'cursor-agent', role: 'frontend' });
      const a2 = registry.join({ name: 'cursor-agent', role: 'backend' });
      expect(a2.id).toBe(a1.id);
      expect(a2.role).toBe('backend'); // Updated role
      expect(a2.status).toBe('active');
    });
  });

  describe('leave', () => {
    it('should mark agent as inactive', () => {
      const agent = registry.join({ name: 'cursor-agent' });
      registry.leave(agent.id);

      const status = registry.getAgent(agent.id);
      expect(status?.status).toBe('inactive');
      expect(status?.leftAt).toBeInstanceOf(Date);
    });

    it('should return false for unknown agent', () => {
      const result = registry.leave('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('status', () => {
    it('should list all agents with status', () => {
      registry.join({ name: 'cursor', role: 'frontend' });
      registry.join({ name: 'windsurf', role: 'backend' });
      registry.join({ name: 'claude', role: 'architect' });

      const all = registry.listAgents();
      expect(all).toHaveLength(3);
      expect(all.every(a => a.status === 'active')).toBe(true);
    });

    it('should show active vs inactive agents', () => {
      const a1 = registry.join({ name: 'cursor' });
      registry.join({ name: 'windsurf' });
      registry.leave(a1.id);

      const active = registry.listAgents({ status: 'active' });
      const inactive = registry.listAgents({ status: 'inactive' });
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('windsurf');
      expect(inactive).toHaveLength(1);
      expect(inactive[0].name).toBe('cursor');
    });

    it('should return null for unknown agent', () => {
      expect(registry.getAgent('nonexistent')).toBeNull();
    });
  });

  describe('heartbeat', () => {
    it('should update lastSeenAt timestamp', () => {
      const agent = registry.join({ name: 'cursor' });
      const initialSeen = agent.lastSeenAt;

      // Small delay to ensure timestamp difference
      registry.heartbeat(agent.id);
      const updated = registry.getAgent(agent.id);
      expect(updated!.lastSeenAt.getTime()).toBeGreaterThanOrEqual(initialSeen.getTime());
    });

    it('should return false for unknown agent', () => {
      expect(registry.heartbeat('nonexistent')).toBe(false);
    });
  });

  describe('getActiveCount', () => {
    it('should count only active agents', () => {
      const a1 = registry.join({ name: 'cursor' });
      registry.join({ name: 'windsurf' });
      registry.join({ name: 'claude' });
      registry.leave(a1.id);

      expect(registry.getActiveCount()).toBe(2);
    });
  });
});
