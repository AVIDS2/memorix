import { describe, it, expect } from 'vitest';
import {
  calculateProjectAffinity,
  extractProjectKeywords,
  type AffinityContext,
  type MemoryContent,
} from '../../src/store/project-affinity.js';

describe('calculateProjectAffinity', () => {
  const context: AffinityContext = {
    projectName: 'relay-message-board',
    projectId: 'local/relay-message-board',
    projectKeywords: ['relay', 'message', 'board', 'relay-message-board'],
  };

  it('returns high affinity when project name is in title', () => {
    const memory: MemoryContent = {
      title: 'relay-message-board API design',
      narrative: 'Designed the REST API endpoints',
    };
    const result = calculateProjectAffinity(memory, context);
    expect(result.level).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it('returns high affinity when project name is in narrative', () => {
    const memory: MemoryContent = {
      title: 'API design decisions',
      narrative: 'For the relay-message-board project, we chose Express',
    };
    const result = calculateProjectAffinity(memory, context);
    expect(result.level).toBe('high');
    expect(result.score).toBe(1.0);
  });

  it('returns high affinity when project name is in file path', () => {
    const memory: MemoryContent = {
      title: 'Updated server code',
      filesModified: ['e:/code/relay-message-board/server.js'],
    };
    const result = calculateProjectAffinity(memory, context);
    expect(result.level).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it('returns medium affinity when keywords match', () => {
    const memory: MemoryContent = {
      title: 'Message board feature',
      narrative: 'Implemented the relay functionality',
    };
    const result = calculateProjectAffinity(memory, context);
    // Should match 'relay' and 'message' keywords
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it('returns low affinity when no project reference', () => {
    const memory: MemoryContent = {
      title: 'Memorix development session',
      narrative: 'Implemented Compact on Write engine for Memorix',
      concepts: ['memorix', 'compact-on-write', 'mcp'],
    };
    const result = calculateProjectAffinity(memory, context);
    expect(result.level).toBe('low');
    expect(result.score).toBe(0.3);
  });

  it('handles empty memory content gracefully', () => {
    const memory: MemoryContent = {
      title: '',
    };
    const result = calculateProjectAffinity(memory, context);
    expect(result.level).toBe('low');
    expect(result.score).toBe(0.3);
  });

  it('detects project in entity name', () => {
    const memory: MemoryContent = {
      title: 'Server configuration',
      entityName: 'relay-message-board-server',
    };
    const result = calculateProjectAffinity(memory, context);
    expect(result.level).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it('detects project in concepts', () => {
    const memory: MemoryContent = {
      title: 'Architecture decisions',
      concepts: ['express', 'relay-message-board', 'rest-api'],
    };
    const result = calculateProjectAffinity(memory, context);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });
});

describe('extractProjectKeywords', () => {
  it('extracts base name from projectId', () => {
    const keywords = extractProjectKeywords('memorix', 'AVIDS2/memorix');
    expect(keywords).toContain('memorix');
  });

  it('generates variations with different separators', () => {
    const keywords = extractProjectKeywords('relay-message-board', 'local/relay-message-board');
    expect(keywords).toContain('relay-message-board');
    expect(keywords).toContain('relay_message_board');
    expect(keywords).toContain('relaymessageboard');
  });

  it('filters out short keywords', () => {
    const keywords = extractProjectKeywords('ab', 'local/ab');
    // 'ab' is too short (< 3 chars)
    expect(keywords.every(k => k.length > 2)).toBe(true);
  });

  it('handles simple project names', () => {
    const keywords = extractProjectKeywords('memorix', 'local/memorix');
    expect(keywords).toContain('memorix');
    expect(keywords.length).toBeGreaterThanOrEqual(1);
  });
});

describe('cross-project pollution prevention', () => {
  it('penalizes Memorix memories in for_memmcp_test project', () => {
    const context: AffinityContext = {
      projectName: 'for_memmcp_test',
      projectId: 'local/for_memmcp_test',
      projectKeywords: ['for_memmcp_test', 'for-memmcp-test', 'formemmcptest'],
    };

    // Memory about Memorix development (should be penalized)
    const memorixMemory: MemoryContent = {
      title: 'Compact on Write engine: Mem0 + Cipher dual-mode',
      narrative: 'Rewrote memory-manager.ts with Compact on Write architecture',
      concepts: ['compact-on-write', 'mem0', 'cipher', 'memorix'],
      filesModified: ['src/llm/memory-manager.ts', 'src/server.ts'],
    };

    // Memory about the actual project (should have high affinity)
    const projectMemory: MemoryContent = {
      title: 'Relay Message Board API design',
      narrative: 'Designed REST API for the for_memmcp_test relay project',
      concepts: ['express', 'rest-api', 'for_memmcp_test'],
    };

    const memorixResult = calculateProjectAffinity(memorixMemory, context);
    const projectResult = calculateProjectAffinity(projectMemory, context);

    // Memorix memory should have low affinity
    expect(memorixResult.level).toBe('low');
    expect(memorixResult.score).toBeLessThanOrEqual(0.5);

    // Project memory should have high affinity
    expect(projectResult.level).toBe('high');
    expect(projectResult.score).toBeGreaterThanOrEqual(0.8);

    // Project memory should rank higher
    expect(projectResult.score).toBeGreaterThan(memorixResult.score);
  });
});
