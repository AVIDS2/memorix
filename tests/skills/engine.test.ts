/**
 * Skills Engine Tests
 *
 * Tests the memory-driven project skills system:
 * - Listing skills from agent directories
 * - Generating skills from observation patterns
 * - Skill scoring and filtering
 * - SKILL.md content generation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillsEngine } from '../../src/skills/engine.js';

function createTmpDir(): string {
    const dir = join(tmpdir(), `memorix-skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

describe('SkillsEngine', () => {
    let tmpDir: string;
    let engine: SkillsEngine;

    beforeEach(() => {
        tmpDir = createTmpDir();
        engine = new SkillsEngine(tmpDir, { skipGlobal: true });
    });

    afterEach(() => {
        if (existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ============================================================
    // List Skills
    // ============================================================

    describe('listSkills', () => {
        it('should return empty array when no skills exist', () => {
            const skills = engine.listSkills();
            expect(skills).toEqual([]);
        });

        it('should discover SKILL.md from .cursor/skills', () => {
            const skillDir = join(tmpDir, '.cursor', 'skills', 'my-skill');
            mkdirSync(skillDir, { recursive: true });
            writeFileSync(join(skillDir, 'SKILL.md'), [
                '---',
                'description: Test skill for code review',
                '---',
                '# My Skill',
                'Instructions here',
            ].join('\n'));

            const skills = engine.listSkills();
            expect(skills).toHaveLength(1);
            expect(skills[0].name).toBe('my-skill');
            expect(skills[0].description).toBe('Test skill for code review');
            expect(skills[0].sourceAgent).toBe('cursor');
            expect(skills[0].generated).toBe(false);
            expect(skills[0].content).toContain('# My Skill');
        });

        it('should discover from .agents/skills (codex)', () => {
            const skillDir = join(tmpDir, '.agents', 'skills', 'deploy-tool');
            mkdirSync(skillDir, { recursive: true });
            writeFileSync(join(skillDir, 'SKILL.md'), [
                '---',
                'description: Deploy automation',
                '---',
                '# Deploy Tool',
            ].join('\n'));

            const skills = engine.listSkills();
            expect(skills).toHaveLength(1);
            expect(skills[0].name).toBe('deploy-tool');
            expect(skills[0].sourceAgent).toBe('codex');
        });

        it('should discover from .agent/skills (antigravity)', () => {
            const skillDir = join(tmpDir, '.agent', 'skills', 'code-review');
            mkdirSync(skillDir, { recursive: true });
            writeFileSync(join(skillDir, 'SKILL.md'), [
                '---',
                'description: Structured code review',
                '---',
                '# Code Review',
            ].join('\n'));

            const skills = engine.listSkills();
            expect(skills).toHaveLength(1);
            expect(skills[0].sourceAgent).toBe('antigravity');
        });

        it('should deduplicate skills with same name across agents', () => {
            // Create same skill name in two agents
            const cursorDir = join(tmpDir, '.cursor', 'skills', 'universal');
            const codexDir = join(tmpDir, '.agents', 'skills', 'universal');
            mkdirSync(cursorDir, { recursive: true });
            mkdirSync(codexDir, { recursive: true });

            writeFileSync(join(cursorDir, 'SKILL.md'), '---\ndescription: From cursor\n---\n# Universal');
            writeFileSync(join(codexDir, 'SKILL.md'), '---\ndescription: From codex\n---\n# Universal');

            const skills = engine.listSkills();
            // Should only return one (first discovered)
            expect(skills).toHaveLength(1);
        });

        it('should skip directories without SKILL.md', () => {
            const dir = join(tmpDir, '.cursor', 'skills', 'incomplete');
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'README.md'), '# Not a skill');

            const skills = engine.listSkills();
            expect(skills).toHaveLength(0);
        });
    });

    // ============================================================
    // Generate from Observations
    // ============================================================

    describe('generateFromObservations', () => {
        it('should return empty array when insufficient observations', () => {
            const obs = [
                { id: 1, entityName: 'auth', type: 'discovery', title: 'Found auth', narrative: 'Some discovery', facts: [], concepts: [], filesModified: [] },
            ];
            const skills = engine.generateFromObservations(obs);
            expect(skills).toHaveLength(0);
        });

        it('should generate skill for entity with rich observations', () => {
            const obs = [
                { id: 1, entityName: 'auth-module', type: 'gotcha', title: 'JWT expiry trap', narrative: 'Tokens expire silently', facts: ['Default TTL: 60s'], concepts: ['jwt', 'auth'], filesModified: ['src/auth.ts'] },
                { id: 2, entityName: 'auth-module', type: 'decision', title: 'Use bcrypt over argon2', narrative: 'Better cross-platform support', facts: ['bcrypt rounds: 12'], concepts: ['hashing'] },
                { id: 3, entityName: 'auth-module', type: 'how-it-works', title: 'Auth flow explained', narrative: 'Login → JWT → refresh cycle', concepts: ['auth-flow'] },
                { id: 4, entityName: 'auth-module', type: 'problem-solution', title: 'Fix token refresh race', narrative: 'Use mutex for concurrent refreshes', facts: ['Mutex library: async-mutex'], filesModified: ['src/auth.ts', 'src/token.ts'] },
                { id: 5, entityName: 'auth-module', type: 'trade-off', title: 'Session vs JWT', narrative: 'Chose JWT for stateless scalability at cost of revocation complexity' },
            ];

            const skills = engine.generateFromObservations(obs);
            expect(skills.length).toBeGreaterThanOrEqual(1);

            const authSkill = skills.find(s => s.name === 'auth-module');
            expect(authSkill).toBeDefined();
            expect(authSkill!.generated).toBe(true);
            expect(authSkill!.content).toContain('auth-module');
            expect(authSkill!.content).toContain('JWT expiry trap');
            expect(authSkill!.content).toContain('Gotcha');
            expect(authSkill!.content).toContain('Architecture Decisions');
            expect(authSkill!.content).toContain('How It Works');
            expect(authSkill!.content).toContain('Common Problems');
            expect(authSkill!.content).toContain('Trade-off');
            expect(authSkill!.description).toContain('auth-module');
        });

        it('should not generate skill for entity with only low-signal types', () => {
            const obs = [
                { id: 1, entityName: 'logging', type: 'discovery', title: 'Found logger', narrative: 'Uses winston' },
                { id: 2, entityName: 'logging', type: 'discovery', title: 'Found formatter', narrative: 'JSON format' },
                { id: 3, entityName: 'logging', type: 'what-changed', title: 'Changed log level', narrative: 'Debug to info' },
            ];

            const skills = engine.generateFromObservations(obs);
            // Low-signal types shouldn't reach the score threshold
            expect(skills).toHaveLength(0);
        });

        it('should prioritize entities with more gotchas', () => {
            const obs = [
                // Entity A: many gotchas
                { id: 1, entityName: 'database', type: 'gotcha', title: 'Connection pool leak', narrative: 'Must close connections' },
                { id: 2, entityName: 'database', type: 'gotcha', title: 'Transaction deadlock', narrative: 'Order matters' },
                { id: 3, entityName: 'database', type: 'gotcha', title: 'Migration rollback', narrative: 'Test backwards compat' },
                { id: 4, entityName: 'database', type: 'decision', title: 'Use Postgres', narrative: 'Better JSON support' },
                // Entity B: fewer, less critical
                { id: 5, entityName: 'config', type: 'how-it-works', title: 'Config loading', narrative: 'ENV > file > defaults' },
                { id: 6, entityName: 'config', type: 'how-it-works', title: 'Config validation', narrative: 'Uses zod' },
                { id: 7, entityName: 'config', type: 'how-it-works', title: 'Config caching', narrative: 'Cached at startup' },
            ];

            const skills = engine.generateFromObservations(obs);
            if (skills.length >= 2) {
                // Database should rank higher due to gotchas
                expect(skills[0].name).toBe('database');
            }
        });

        it('should include facts and concepts in generated skill', () => {
            const obs = [
                { id: 1, entityName: 'api', type: 'gotcha', title: 'Rate limit', narrative: 'API has rate limits', facts: ['Limit: 100/min', 'Reset: 60s'], concepts: ['rate-limiting', 'api'] },
                { id: 2, entityName: 'api', type: 'decision', title: 'Use REST', narrative: 'GraphQL too complex', facts: ['Endpoints: 15'], concepts: ['rest', 'api'] },
                { id: 3, entityName: 'api', type: 'how-it-works', title: 'API auth', narrative: 'Bearer token auth', concepts: ['auth', 'bearer'] },
            ];

            const skills = engine.generateFromObservations(obs);
            expect(skills.length).toBeGreaterThanOrEqual(1);

            const apiSkill = skills[0];
            expect(apiSkill.content).toContain('Quick Facts');
            expect(apiSkill.content).toContain('Limit: 100/min');
            expect(apiSkill.content).toContain('Related Concepts');
            expect(apiSkill.content).toContain('rate-limiting');
        });

        it('should generate valid SKILL.md frontmatter', () => {
            const obs = [
                { id: 1, entityName: 'deploy', type: 'gotcha', title: 'Docker cache', narrative: 'Layer ordering matters' },
                { id: 2, entityName: 'deploy', type: 'decision', title: 'Use multi-stage', narrative: 'Smaller images' },
                { id: 3, entityName: 'deploy', type: 'how-it-works', title: 'CI pipeline', narrative: 'GitHub Actions flow' },
            ];

            const skills = engine.generateFromObservations(obs);
            expect(skills.length).toBeGreaterThanOrEqual(1);

            const content = skills[0].content;
            expect(content).toMatch(/^---\n/);
            expect(content).toContain('description:');
            expect(content).toMatch(/---\n\n#/);
        });

        it('should ignore low-signal command traces when generating skills', () => {
            const obs = [
                { id: 1, entityName: 'npm', type: 'what-changed', title: 'Ran: npx vitest run', narrative: 'Command: npx vitest run tests/skills/engine.test.ts 2>&1 | Select-String vitest', source: 'agent' as const },
                { id: 2, entityName: 'mcp_memorix_memorix_search', type: 'discovery', title: 'Ran: memorix_search', narrative: 'Command: memorix_search query=skills | Get-Content output.txt', source: 'agent' as const },
                { id: 3, entityName: 'gh', type: 'what-changed', title: 'Ran: gh pr view', narrative: 'Command: gh pr view 17 && git status', source: 'manual' as const },
                { id: 4, entityName: 'auth-module', type: 'gotcha', title: 'JWT expiry trap', narrative: 'Tokens expire silently', facts: ['Default TTL: 60s'], source: 'agent' as const },
                { id: 5, entityName: 'auth-module', type: 'decision', title: 'Use refresh rotation', narrative: 'Reduces replay risk', source: 'agent' as const },
                { id: 6, entityName: 'auth-module', type: 'how-it-works', title: 'Auth refresh flow', narrative: 'Access token rotates through a refresh endpoint', source: 'agent' as const },
            ];

            const skills = engine.generateFromObservations(obs);

            expect(skills).toHaveLength(1);
            expect(skills[0].name).toBe('auth-module');
            expect(skills[0].content).not.toContain('Ran: npx vitest run');
            expect(skills[0].content).not.toContain('memorix_search');
            expect(skills[0].content).not.toContain('gh pr view');
        });

        it('should not turn generic git command history into a skill', () => {
            const obs = [
                { id: 1, entityName: 'git', type: 'decision', title: 'Ran: git commit -m "feat: add git memory"', narrative: 'Command: git commit -m "feat: add git memory"', source: 'git' as const, status: 'resolved' },
                { id: 2, entityName: 'git', type: 'discovery', title: 'Ran: git diff --stat HEAD~1..HEAD', narrative: 'Command: git diff --stat HEAD~1..HEAD', source: 'git' as const, status: 'resolved' },
                { id: 3, entityName: 'git', type: 'problem-solution', title: 'Ran: git push origin main', narrative: 'Command: git push origin main', source: 'git' as const },
                { id: 4, entityName: 'release-pipeline', type: 'decision', title: 'Tag releases after green CI', narrative: 'Release tags are only cut after CI passes on main', source: 'git' as const },
                { id: 5, entityName: 'release-pipeline', type: 'how-it-works', title: 'Release flow overview', narrative: 'Main branch tags drive release notes and npm publication', source: 'git' as const },
                { id: 6, entityName: 'release-pipeline', type: 'trade-off', title: 'Manual publish keeps 2FA', narrative: 'We prefer manual npm publish to preserve interactive 2FA', source: 'agent' as const },
            ];

            const skills = engine.generateFromObservations(obs);

            expect(skills).toHaveLength(1);
            expect(skills[0].name).toBe('release-pipeline');
            expect(skills[0].content).not.toContain('Ran: git commit');
            expect(skills[0].content).not.toContain('git push origin main');
        });
    });

    // ============================================================
    // Inject
    // ============================================================

    describe('injectSkill', () => {
        it('should return null for non-existent skill', () => {
            const result = engine.injectSkill('nonexistent');
            expect(result).toBeNull();
        });

        it('should return full content for existing skill', () => {
            const skillDir = join(tmpDir, '.cursor', 'skills', 'test-inject');
            mkdirSync(skillDir, { recursive: true });
            const content = '---\ndescription: Inject test\n---\n# Test\nFull content here';
            writeFileSync(join(skillDir, 'SKILL.md'), content);

            const result = engine.injectSkill('test-inject');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('test-inject');
            expect(result!.content).toBe(content);
        });

        it('should be case-insensitive', () => {
            const skillDir = join(tmpDir, '.cursor', 'skills', 'MySkill');
            mkdirSync(skillDir, { recursive: true });
            writeFileSync(join(skillDir, 'SKILL.md'), '---\ndescription: Case test\n---\n# Test');

            const result = engine.injectSkill('myskill');
            expect(result).not.toBeNull();
        });
    });

    // ============================================================
    // Write Skill
    // ============================================================

    describe('writeSkill', () => {
        it('should write skill to target agent directory', () => {
            const skill = {
                name: 'generated-skill',
                description: 'A generated skill',
                sourcePath: '',
                sourceAgent: 'codex' as const,
                content: '---\ndescription: Generated\n---\n# Generated Skill\nContent',
                generated: true,
            };

            const result = engine.writeSkill(skill, 'cursor');
            expect(result).not.toBeNull();
            expect(result!.replace(/\\/g, '/')).toContain('.cursor/skills/generated-skill/SKILL.md');

            const written = join(tmpDir, '.cursor', 'skills', 'generated-skill', 'SKILL.md');
            expect(existsSync(written)).toBe(true);
        });

        it('should write to antigravity agent directory', () => {
            const skill = {
                name: 'test-skill',
                description: 'Test',
                sourcePath: '',
                sourceAgent: 'codex' as const,
                content: '---\ndescription: Test\n---\n# Test',
                generated: true,
            };

            const result = engine.writeSkill(skill, 'antigravity');
            expect(result).not.toBeNull();
            expect(result!.replace(/\\/g, '/')).toContain('.agent/skills/test-skill/SKILL.md');
        });
    });
});
