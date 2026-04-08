import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  promoteToMiniSkill,
  loadMiniSkills,
  loadAllMiniSkills,
  deleteMiniSkill,
  recordMiniSkillUsage,
  formatMiniSkillsForInjection,
} from '../../src/skills/mini-skills.js';
import { initMiniSkillStore, resetMiniSkillStore } from '../../src/store/mini-skill-store.js';
import type { Observation } from '../../src/types.js';

// ── Test fixtures ────────────────────────────────────────────────

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: 1,
    entityName: 'auth-module',
    type: 'gotcha',
    title: 'JWT tokens expire silently',
    narrative: 'JWT refresh tokens are not auto-renewed, causing silent auth failures after 24h.',
    facts: ['Default JWT expiry: 24h', 'No auto-refresh mechanism'],
    filesModified: ['src/auth/jwt.ts', 'src/middleware/auth.ts'],
    concepts: ['jwt', 'authentication', 'token-refresh'],
    tokens: 150,
    createdAt: new Date().toISOString(),
    projectId: 'test-project',
    ...overrides,
  };
}

// ── Setup / teardown ─────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = path.join(os.tmpdir(), `memorix-mini-skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(testDir, { recursive: true });
  resetMiniSkillStore();
  await initMiniSkillStore(testDir);
});

afterEach(async () => {
  resetMiniSkillStore();
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// ── Tests ────────────────────────────────────────────────────────

describe('promoteToMiniSkill', () => {
  it('should create a mini-skill from a single observation', async () => {
    const obs = makeObservation();
    const skill = await promoteToMiniSkill(testDir, 'test-project', [obs]);

    expect(skill.id).toBe(1);
    expect(skill.sourceObservationIds).toEqual([1]);
    expect(skill.sourceEntity).toBe('auth-module');
    expect(skill.title).toBe('JWT tokens expire silently');
    expect(skill.instruction).toContain('Avoid');
    expect(skill.trigger).toContain('auth-module');
    expect(skill.facts).toContain('Default JWT expiry: 24h');
    expect(skill.projectId).toBe('test-project');
    expect(skill.usedCount).toBe(0);
    expect(skill.tags).toContain('gotcha');
  });

  it('should auto-generate instruction based on observation type', async () => {
    const gotcha = makeObservation({ type: 'gotcha', narrative: 'Never use string concat for paths' });
    const decision = makeObservation({ id: 2, type: 'decision', narrative: 'Use path.join for all file paths' });
    const fix = makeObservation({ id: 3, type: 'problem-solution', narrative: 'Replace concat with path.join' });

    const s1 = await promoteToMiniSkill(testDir, 'p', [gotcha]);
    const s2 = await promoteToMiniSkill(testDir, 'p', [decision]);
    const s3 = await promoteToMiniSkill(testDir, 'p', [fix]);

    expect(s1.instruction).toMatch(/^Avoid:/);
    expect(s2.instruction).toMatch(/^Follow:/);
    expect(s3.instruction).toMatch(/^Apply fix:/);
  });

  it('should allow custom trigger and instruction overrides', async () => {
    const obs = makeObservation();
    const skill = await promoteToMiniSkill(testDir, 'test-project', [obs], {
      trigger: 'When modifying auth middleware',
      instruction: 'Always check token expiry before proceeding',
    });

    expect(skill.trigger).toBe('When modifying auth middleware');
    expect(skill.instruction).toBe('Always check token expiry before proceeding');
  });

  it('should increment IDs for multiple skills', async () => {
    const obs1 = makeObservation({ id: 1 });
    const obs2 = makeObservation({ id: 2, title: 'CORS must be set explicitly' });

    const s1 = await promoteToMiniSkill(testDir, 'p', [obs1]);
    const s2 = await promoteToMiniSkill(testDir, 'p', [obs2]);

    expect(s1.id).toBe(1);
    expect(s2.id).toBe(2);
  });

  it('should handle multiple source observations', async () => {
    const obs1 = makeObservation({ id: 1, facts: ['Fact A'] });
    const obs2 = makeObservation({ id: 2, facts: ['Fact B', 'Fact C'] });

    const skill = await promoteToMiniSkill(testDir, 'p', [obs1, obs2]);

    expect(skill.sourceObservationIds).toEqual([1, 2]);
    expect(skill.facts).toContain('Fact A');
    expect(skill.facts).toContain('Fact B');
    expect(skill.facts).toContain('Fact C');
  });

  it('should add extra tags', async () => {
    const obs = makeObservation();
    const skill = await promoteToMiniSkill(testDir, 'p', [obs], {
      tags: ['critical', 'security'],
    });

    expect(skill.tags).toContain('critical');
    expect(skill.tags).toContain('security');
    expect(skill.tags).toContain('gotcha');
  });
});

describe('loadMiniSkills', () => {
  it('should return empty array when no skills exist', async () => {
    const skills = await loadMiniSkills(testDir);
    expect(skills).toEqual([]);
  });

  it('should filter by projectId', async () => {
    const obs1 = makeObservation({ id: 1 });
    const obs2 = makeObservation({ id: 2, title: 'Other skill' });

    await promoteToMiniSkill(testDir, 'project-a', [obs1]);
    await promoteToMiniSkill(testDir, 'project-b', [obs2]);

    const skillsA = await loadMiniSkills(testDir, 'project-a');
    const skillsB = await loadMiniSkills(testDir, 'project-b');
    const skillsAll = await loadAllMiniSkills(testDir);

    expect(skillsA).toHaveLength(1);
    expect(skillsB).toHaveLength(1);
    expect(skillsAll).toHaveLength(2);
  });
});

describe('deleteMiniSkill', () => {
  it('should delete a mini-skill by ID', async () => {
    const obs = makeObservation();
    const skill = await promoteToMiniSkill(testDir, 'p', [obs]);

    const deleted = await deleteMiniSkill(testDir, skill.id);
    expect(deleted).toBe(true);

    const remaining = await loadAllMiniSkills(testDir);
    expect(remaining).toHaveLength(0);
  });

  it('should return false for non-existent ID', async () => {
    const deleted = await deleteMiniSkill(testDir, 999);
    expect(deleted).toBe(false);
  });
});

describe('recordMiniSkillUsage', () => {
  it('should increment usedCount', async () => {
    const obs = makeObservation();
    await promoteToMiniSkill(testDir, 'p', [obs]);

    await recordMiniSkillUsage(testDir, [1]);
    await recordMiniSkillUsage(testDir, [1]);

    const skills = await loadAllMiniSkills(testDir);
    expect(skills[0].usedCount).toBe(2);
  });

  it('should handle empty array gracefully', async () => {
    await recordMiniSkillUsage(testDir, []);
    // Should not throw
  });
});

describe('formatMiniSkillsForInjection', () => {
  it('should return empty string for no skills', () => {
    const result = formatMiniSkillsForInjection([]);
    expect(result).toBe('');
  });

  it('should format skills as markdown', async () => {
    const obs = makeObservation();
    const skill = await promoteToMiniSkill(testDir, 'p', [obs]);

    const formatted = formatMiniSkillsForInjection([skill]);

    expect(formatted).toContain('## 🎯 Project Mini-Skills (1 active)');
    expect(formatted).toContain('JWT tokens expire silently');
    expect(formatted).toContain('**Do**:');
    expect(formatted).toContain('**When**:');
    expect(formatted).toContain('Default JWT expiry: 24h');
  });

  it('should format multiple skills', async () => {
    const obs1 = makeObservation({ id: 1 });
    const obs2 = makeObservation({ id: 2, title: 'CORS headers required' });

    const s1 = await promoteToMiniSkill(testDir, 'p', [obs1]);
    const s2 = await promoteToMiniSkill(testDir, 'p', [obs2]);

    const formatted = formatMiniSkillsForInjection([s1, s2]);
    expect(formatted).toContain('2 active');
  });
});

describe('persistence', () => {
  it('should survive reload from disk', async () => {
    const obs = makeObservation();
    await promoteToMiniSkill(testDir, 'test-project', [obs], {
      trigger: 'When touching auth code',
      instruction: 'Check token refresh',
      tags: ['auth'],
    });

    // Load from disk (fresh)
    const skills = await loadAllMiniSkills(testDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].title).toBe('JWT tokens expire silently');
    expect(skills[0].trigger).toBe('When touching auth code');
    expect(skills[0].instruction).toBe('Check token refresh');
    expect(skills[0].tags).toContain('auth');
  });

  it('should persist after delete', async () => {
    const obs1 = makeObservation({ id: 1 });
    const obs2 = makeObservation({ id: 2, title: 'Second skill' });

    await promoteToMiniSkill(testDir, 'p', [obs1]);
    await promoteToMiniSkill(testDir, 'p', [obs2]);

    await deleteMiniSkill(testDir, 1);

    const skills = await loadAllMiniSkills(testDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].title).toBe('Second skill');
  });
});
