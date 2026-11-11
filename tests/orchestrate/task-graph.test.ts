import { describe, it, expect } from 'vitest';
import {
  parseTaskGraph,
  hasCycle,
  topologicalSort,
  findParallelGroups,
  longestChain,
  type TaskNode,
} from '../../src/orchestrate/task-graph.js';

// ── Helper: minimal valid graph ────────────────────────────────────

function validGraph() {
  return {
    summary: 'Build a simple web page with HTML and CSS',
    tasks: [
      { tempId: 't1', role: 'pm' as const, description: 'Write functional spec for the landing page with acceptance criteria and file paths', deps: [] },
      { tempId: 't2', role: 'engineer' as const, description: 'Implement the landing page HTML and CSS according to spec written by PM', deps: ['t1'] },
      { tempId: 't3', role: 'qa' as const, description: 'Test the landing page for correctness against the PM spec document', deps: ['t2'] },
      { tempId: 't4', role: 'reviewer' as const, description: 'Review all completed work for quality and completeness', deps: ['t1', 't2', 't3'] },
    ],
  };
}

describe('task-graph', () => {
  describe('parseTaskGraph', () => {
    it('should parse a valid JSON task graph', () => {
      const result = parseTaskGraph(JSON.stringify(validGraph()));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tasks).toHaveLength(4);
        expect(result.warnings).toBeInstanceOf(Array);
      }
    });

    it('should extract JSON from fenced code block', () => {
      const raw = `Here is my plan:\n\`\`\`json\n${JSON.stringify(validGraph())}\n\`\`\`\nDone.`;
      const result = parseTaskGraph(raw);
      expect(result.success).toBe(true);
    });

    it('should extract bare JSON from mixed text', () => {
      const raw = `Let me think...\n${JSON.stringify(validGraph())}\nThat's my plan.`;
      const result = parseTaskGraph(raw);
      expect(result.success).toBe(true);
    });

    it('should reject graph with no JSON', () => {
      const result = parseTaskGraph('No JSON here, just text.');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('No valid JSON');
    });

    it('should reject graph where last task is not reviewer', () => {
      const g = validGraph();
      // Swap reviewer to second position
      [g.tasks[1], g.tasks[3]] = [g.tasks[3], g.tasks[1]];
      const result = parseTaskGraph(JSON.stringify(g));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('reviewer');
    });

    it('should reject graph with unknown dependency reference', () => {
      const g = validGraph();
      g.tasks[1].deps = ['nonexistent'];
      const result = parseTaskGraph(JSON.stringify(g));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('unknown dependency');
    });

    it('should reject graph with cycle', () => {
      const g = {
        summary: 'Cycle test plan for validation purposes',
        tasks: [
          { tempId: 'a', role: 'pm' as const, description: 'Task A depends on C creating a cycle in the graph', deps: ['c'] },
          { tempId: 'b', role: 'engineer' as const, description: 'Task B depends on A which is part of the cycle chain', deps: ['a'] },
          { tempId: 'c', role: 'reviewer' as const, description: 'Task C depends on B completing the circular dependency', deps: ['b'] },
        ],
      };
      const result = parseTaskGraph(JSON.stringify(g));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('cycle');
    });

    it('should reject graph with duplicate tempIds', () => {
      const g = validGraph();
      g.tasks[1].tempId = 't1'; // duplicate
      const result = parseTaskGraph(JSON.stringify(g));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('Duplicate');
    });

    it('should reject self-referencing task', () => {
      const g = validGraph();
      g.tasks[0].deps = ['t1']; // self-reference
      const result = parseTaskGraph(JSON.stringify(g));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('itself');
    });

    it('should produce warnings for overly linear graph', () => {
      const g = {
        summary: 'Linear chain test with many sequential tasks',
        tasks: [
          { tempId: 't1', role: 'pm' as const, description: 'First task in the chain with sufficient description for validation', deps: [] },
          { tempId: 't2', role: 'engineer' as const, description: 'Second task in the chain depends on first task for sequential flow', deps: ['t1'] },
          { tempId: 't3', role: 'engineer' as const, description: 'Third task in the chain depends on second task continuing the linear flow', deps: ['t2'] },
          { tempId: 't4', role: 'qa' as const, description: 'Fourth task in the chain depends on third task for testing validation', deps: ['t3'] },
          { tempId: 't5', role: 'reviewer' as const, description: 'Fifth and final task reviews everything in this very linear chain', deps: ['t4'] },
        ],
      };
      const result = parseTaskGraph(JSON.stringify(g));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.warnings.some(w => w.includes('linear'))).toBe(true);
      }
    });
  });

  describe('hasCycle', () => {
    it('should detect no cycle in a DAG', () => {
      expect(hasCycle([
        { tempId: 'a', deps: [] },
        { tempId: 'b', deps: ['a'] },
        { tempId: 'c', deps: ['a', 'b'] },
      ])).toBe(false);
    });

    it('should detect a simple cycle', () => {
      expect(hasCycle([
        { tempId: 'a', deps: ['b'] },
        { tempId: 'b', deps: ['a'] },
      ])).toBe(true);
    });

    it('should detect a 3-node cycle', () => {
      expect(hasCycle([
        { tempId: 'a', deps: ['c'] },
        { tempId: 'b', deps: ['a'] },
        { tempId: 'c', deps: ['b'] },
      ])).toBe(true);
    });
  });

  describe('topologicalSort', () => {
    it('should sort a simple DAG', () => {
      const tasks: TaskNode[] = [
        { tempId: 'c', role: 'reviewer', description: 'Review task depends on a and b for final check', deps: ['a', 'b'] },
        { tempId: 'a', role: 'pm', description: 'PM task with no dependencies starts the workflow', deps: [] },
        { tempId: 'b', role: 'engineer', description: 'Engineer task depends on PM completing the spec', deps: ['a'] },
      ];
      const sorted = topologicalSort(tasks);
      const ids = sorted.map(t => t.tempId);
      expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
      expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'));
    });

    it('should throw on cycle', () => {
      const tasks: TaskNode[] = [
        { tempId: 'a', role: 'pm', description: 'A depends on B creating a circular dependency issue', deps: ['b'] },
        { tempId: 'b', role: 'reviewer', description: 'B depends on A which completes the cycle loop', deps: ['a'] },
      ];
      expect(() => topologicalSort(tasks)).toThrow('cycle');
    });
  });

  describe('findParallelGroups', () => {
    it('should identify parallel groups in a diamond', () => {
      const tasks: TaskNode[] = [
        { tempId: 'a', role: 'pm', description: 'Root task with no deps starts everything going now', deps: [] },
        { tempId: 'b', role: 'engineer', description: 'Branch B depends only on A and can run with C', deps: ['a'] },
        { tempId: 'c', role: 'engineer', description: 'Branch C depends only on A and can run with B', deps: ['a'] },
        { tempId: 'd', role: 'reviewer', description: 'Merge task depends on both B and C for review', deps: ['b', 'c'] },
      ];
      const groups = findParallelGroups(tasks);
      expect(groups).toHaveLength(3);
      expect(groups[0]).toEqual(['a']);
      expect(groups[1].sort()).toEqual(['b', 'c']);
      expect(groups[2]).toEqual(['d']);
    });

    it('should return single-element groups for linear chain', () => {
      const tasks: TaskNode[] = [
        { tempId: 'a', role: 'pm', description: 'First in chain with no dependencies at all now', deps: [] },
        { tempId: 'b', role: 'engineer', description: 'Second in chain depends on first task to complete', deps: ['a'] },
        { tempId: 'c', role: 'reviewer', description: 'Third in chain depends on second task to complete', deps: ['b'] },
      ];
      const groups = findParallelGroups(tasks);
      expect(groups).toHaveLength(3);
      expect(groups.every(g => g.length === 1)).toBe(true);
    });
  });

  describe('longestChain', () => {
    it('should return 1 for a single node', () => {
      expect(longestChain([{ tempId: 'a', deps: [] }])).toBe(1);
    });

    it('should return chain length for linear graph', () => {
      expect(longestChain([
        { tempId: 'a', deps: [] },
        { tempId: 'b', deps: ['a'] },
        { tempId: 'c', deps: ['b'] },
      ])).toBe(3);
    });

    it('should handle diamond (longest path)', () => {
      expect(longestChain([
        { tempId: 'a', deps: [] },
        { tempId: 'b', deps: ['a'] },
        { tempId: 'c', deps: ['a'] },
        { tempId: 'd', deps: ['b', 'c'] },
      ])).toBe(3); // a→b→d or a→c→d
    });
  });
});
