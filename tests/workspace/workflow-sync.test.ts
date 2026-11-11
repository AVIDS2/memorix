import { describe, it, expect } from 'vitest';
import type { WorkflowEntry } from '../../src/types.js';
import { WorkflowSyncer } from '../../src/workspace/workflow-sync.js';

// ============================================================
// Test Data
// ============================================================

const sampleWorkflows: WorkflowEntry[] = [
  {
    name: 'deploy',
    description: 'Deploy the application to production',
    content: `1. Run tests: \`npm test\`
2. Build: \`npm run build\`
3. Deploy: \`npm run deploy\`
4. Verify deployment at https://example.com`,
    source: 'windsurf',
    filePath: '.windsurf/workflows/deploy.md',
  },
  {
    name: 'pr-review',
    description: 'Review and address PR comments',
    content: `1. Check out the PR branch: \`gh pr checkout [id]\`
2. Get comments on PR
3. For EACH comment, analyze and fix
4. Push changes and summarize`,
    source: 'windsurf',
    filePath: '.windsurf/workflows/pr-review.md',
  },
];

const windsurfWorkflowMd = `---
description: Deploy the application to production
---
1. Run tests: \`npm test\`
2. Build: \`npm run build\`
3. Deploy: \`npm run deploy\`
4. Verify deployment at https://example.com`;

// ============================================================
// Parsing tests
// ============================================================

describe('WorkflowSyncer.parseWindsurfWorkflow', () => {
  const syncer = new WorkflowSyncer();

  it('should parse a Windsurf workflow markdown file', () => {
    const entry = syncer.parseWindsurfWorkflow('deploy.md', windsurfWorkflowMd);
    expect(entry.name).toBe('deploy');
    expect(entry.description).toBe('Deploy the application to production');
    expect(entry.content).toContain('npm test');
    expect(entry.source).toBe('windsurf');
  });

  it('should handle workflow without frontmatter', () => {
    const raw = '1. Do step one\n2. Do step two';
    const entry = syncer.parseWindsurfWorkflow('my-flow.md', raw);
    expect(entry.name).toBe('my-flow');
    expect(entry.description).toBe('');
    expect(entry.content).toContain('Do step one');
  });
});

// ============================================================
// Conversion to Codex SKILL.md
// ============================================================

describe('WorkflowSyncer.toCodexSkill', () => {
  const syncer = new WorkflowSyncer();

  it('should convert a workflow to Codex SKILL.md format', () => {
    const result = syncer.toCodexSkill(sampleWorkflows[0]);
    expect(result.filePath).toBe('.agents/skills/deploy/SKILL.md');
    expect(result.content).toContain('name: deploy');
    expect(result.content).toContain('description: Deploy the application to production');
    expect(result.content).toContain('npm test');
  });

  it('should sanitize names for file paths', () => {
    const wf: WorkflowEntry = {
      ...sampleWorkflows[0],
      name: 'my complex/workflow name!',
    };
    const result = syncer.toCodexSkill(wf);
    expect(result.filePath).toMatch(/^\.agents\/skills\/[a-zA-Z0-9_-]+\/SKILL\.md$/);
  });
});

// ============================================================
// Conversion to Cursor rule
// ============================================================

describe('WorkflowSyncer.toCursorRule', () => {
  const syncer = new WorkflowSyncer();

  it('should convert a workflow to Cursor .mdc rule format', () => {
    const result = syncer.toCursorRule(sampleWorkflows[0]);
    expect(result.filePath).toBe('.cursor/rules/deploy.mdc');
    expect(result.content).toContain('description: Deploy the application to production');
    expect(result.content).toContain('npm test');
  });
});

// ============================================================
// Conversion to Claude Code CLAUDE.md section
// ============================================================

describe('WorkflowSyncer.toClaudeSection', () => {
  const syncer = new WorkflowSyncer();

  it('should convert a workflow to a CLAUDE.md section', () => {
    const result = syncer.toClaudeSection(sampleWorkflows[0]);
    expect(result).toContain('## Workflow: deploy');
    expect(result).toContain('Deploy the application to production');
    expect(result).toContain('npm test');
  });
});

// ============================================================
// Batch conversion
// ============================================================

describe('WorkflowSyncer.convertAll', () => {
  const syncer = new WorkflowSyncer();

  it('should convert all workflows to codex format', () => {
    const results = syncer.convertAll(sampleWorkflows, 'codex');
    expect(results).toHaveLength(2);
    expect(results[0].filePath).toContain('SKILL.md');
    expect(results[1].filePath).toContain('SKILL.md');
  });

  it('should convert all workflows to cursor format', () => {
    const results = syncer.convertAll(sampleWorkflows, 'cursor');
    expect(results).toHaveLength(2);
    expect(results[0].filePath).toContain('.mdc');
  });

  it('should convert all workflows to claude-code format', () => {
    const results = syncer.convertAll(sampleWorkflows, 'claude-code');
    // Claude Code merges into a single CLAUDE.md file
    expect(results).toHaveLength(1);
    expect(results[0].filePath).toBe('CLAUDE.md');
    expect(results[0].content).toContain('## Workflow: deploy');
    expect(results[0].content).toContain('## Workflow: pr-review');
  });

  it('should skip conversion when target is windsurf (same format)', () => {
    const results = syncer.convertAll(sampleWorkflows, 'windsurf');
    expect(results).toHaveLength(0);
  });
});
