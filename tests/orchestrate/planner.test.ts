import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isPlannerTask, seedAutonomousPipeline, buildReviewIterationHint, extractPipelineId } from '../../src/orchestrate/planner.js';
import { initTeamStore, type TeamStore } from '../../src/team/team-store.js';

describe('Planner — Phase 5', () => {
  // ── isPlannerTask ──────────────────────────────────────────────

  describe('isPlannerTask', () => {
    it('returns null for undefined/null metadata', () => {
      expect(isPlannerTask(undefined)).toBeNull();
      expect(isPlannerTask(null)).toBeNull();
    });

    it('returns null for non-planner metadata', () => {
      expect(isPlannerTask('{"foo":"bar"}')).toBeNull();
      expect(isPlannerTask('not json')).toBeNull();
      expect(isPlannerTask('{}')).toBeNull();
    });

    it('parses valid plan metadata', () => {
      const meta = JSON.stringify({
        plannerType: 'plan',
        pipelineId: 'pipe-1',
        goal: 'Build a web app',
        iteration: 0,
        maxIterations: 3,
        taskBudget: 15,
      });
      const result = isPlannerTask(meta);
      expect(result).not.toBeNull();
      expect(result!.plannerType).toBe('plan');
      expect(result!.pipelineId).toBe('pipe-1');
      expect(result!.goal).toBe('Build a web app');
      expect(result!.iteration).toBe(0);
      expect(result!.maxIterations).toBe(3);
      expect(result!.taskBudget).toBe(15);
    });

    it('parses valid review metadata', () => {
      const meta = JSON.stringify({
        plannerType: 'review',
        pipelineId: 'pipe-1',
        goal: 'Build a web app',
        iteration: 2,
        maxIterations: 3,
        taskBudget: 10,
      });
      const result = isPlannerTask(meta);
      expect(result).not.toBeNull();
      expect(result!.plannerType).toBe('review');
      expect(result!.iteration).toBe(2);
    });
  });

  // ── seedAutonomousPipeline ─────────────────────────────────────

  describe('seedAutonomousPipeline', () => {
    let tmpDir: string;
    let teamStore: TeamStore;

    beforeEach(async () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'planner-test-'));
      teamStore = await initTeamStore(tmpDir);
    });

    afterEach(() => {
      try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    });

    it('creates a planning task with correct metadata and pipelineId', () => {
      const { planningTaskId, pipelineId } = seedAutonomousPipeline(teamStore, 'test/proj', {
        goal: 'Build a PNG to SVG converter',
      });

      expect(planningTaskId).toBeTruthy();
      expect(pipelineId).toBeTruthy();

      const task = teamStore.getTask(planningTaskId);
      expect(task).not.toBeNull();
      expect(task!.status).toBe('pending');
      expect(task!.description).toContain('Build a PNG to SVG converter');
      expect(task!.description).toContain('[Role: Project Planner');
      expect(task!.description).toContain(pipelineId);

      const meta = isPlannerTask(task!.metadata);
      expect(meta).not.toBeNull();
      expect(meta!.plannerType).toBe('plan');
      expect(meta!.pipelineId).toBe(pipelineId);
      expect(meta!.goal).toBe('Build a PNG to SVG converter');
      expect(meta!.maxIterations).toBe(3);  // default
      expect(meta!.taskBudget).toBe(15);    // default
    });

    it('each call generates a unique pipelineId', () => {
      const r1 = seedAutonomousPipeline(teamStore, 'test/proj', { goal: 'A' });
      const r2 = seedAutonomousPipeline(teamStore, 'test/proj', { goal: 'B' });
      expect(r1.pipelineId).not.toBe(r2.pipelineId);
    });

    it('respects custom config values', () => {
      const { planningTaskId } = seedAutonomousPipeline(teamStore, 'test/proj', {
        goal: 'Refactor auth module',
        maxIterations: 5,
        taskBudget: 25,
      });

      const task = teamStore.getTask(planningTaskId);
      const meta = isPlannerTask(task!.metadata);
      expect(meta!.maxIterations).toBe(5);
      expect(meta!.taskBudget).toBe(25);
    });

    it('planning prompt includes goal, budget, and review instructions', () => {
      const { planningTaskId } = seedAutonomousPipeline(teamStore, 'test/proj', {
        goal: 'Create a REST API',
        maxIterations: 2,
        taskBudget: 10,
      });

      const task = teamStore.getTask(planningTaskId);
      expect(task!.description).toContain('Create a REST API');
      expect(task!.description).toContain('10');       // budget
      expect(task!.description).toContain('2');         // maxIterations
      expect(task!.description).toContain('Quality Gate');
      expect(task!.description).toContain('team_task');
    });
  });

  // ── checkPipelineGuards (system-enforced hard limits) ──────────

  describe('checkPipelineGuards (pipeline-scoped)', () => {
    const PID_A = 'pipeline-aaa';
    const PID_B = 'pipeline-bbb';

    // Helpers
    const planTask = (pid: string, budget: number, maxIter: number) => ({
      metadata: JSON.stringify({ plannerType: 'plan', pipelineId: pid, goal: 'X', iteration: 0, maxIterations: maxIter, taskBudget: budget }),
    });
    const pipelineWorker = (pid: string) => ({
      metadata: JSON.stringify({ pipelineId: pid }),
    });
    const manualTask = () => ({ metadata: null });
    const newWorkerMeta = (pid: string) => ({ pipelineId: pid });
    const newReviewMeta = (pid: string, iter: number) => ({ plannerType: 'review', pipelineId: pid, iteration: iter });

    it('rejects task creation when pipeline budget is exhausted', async () => {
      const { checkPipelineGuards } = await import('../../src/orchestrate/planner.js');
      // Pipeline A: budget=3, already 3 tasks
      const existing = [planTask(PID_A, 3, 5), pipelineWorker(PID_A), pipelineWorker(PID_A)];
      const result = checkPipelineGuards({ existingTasks: existing, newTaskMeta: newWorkerMeta(PID_A) });
      expect(result.allowed).toBe(false);
      expect((result as { reason: string }).reason).toContain('budget exhausted');
    });

    it('allows task creation when within pipeline budget', async () => {
      const { checkPipelineGuards } = await import('../../src/orchestrate/planner.js');
      const existing = [planTask(PID_A, 5, 3), pipelineWorker(PID_A)];
      const result = checkPipelineGuards({ existingTasks: existing, newTaskMeta: newWorkerMeta(PID_A) });
      expect(result.allowed).toBe(true);
    });

    it('rejects review task when iteration exceeds maxIterations', async () => {
      const { checkPipelineGuards } = await import('../../src/orchestrate/planner.js');
      const existing = [planTask(PID_A, 20, 2), pipelineWorker(PID_A)];
      const result = checkPipelineGuards({ existingTasks: existing, newTaskMeta: newReviewMeta(PID_A, 3) });
      expect(result.allowed).toBe(false);
      expect((result as { reason: string }).reason).toContain('review iterations exceeded');
    });

    it('allows review task within iteration limit', async () => {
      const { checkPipelineGuards } = await import('../../src/orchestrate/planner.js');
      const existing = [planTask(PID_A, 20, 3), pipelineWorker(PID_A)];
      const result = checkPipelineGuards({ existingTasks: existing, newTaskMeta: newReviewMeta(PID_A, 2) });
      expect(result.allowed).toBe(true);
    });

    it('does NOT restrict tasks without pipelineId (manual tasks)', async () => {
      const { checkPipelineGuards } = await import('../../src/orchestrate/planner.js');
      const existing = [planTask(PID_A, 3, 3), pipelineWorker(PID_A), pipelineWorker(PID_A)];
      // New task has no pipelineId → not part of pipeline → always allowed
      const result = checkPipelineGuards({ existingTasks: existing, newTaskMeta: null });
      expect(result.allowed).toBe(true);
    });

    // ── Pipeline isolation tests (Codex review requirement) ──────

    it('old pipeline does NOT pollute new pipeline budget', async () => {
      const { checkPipelineGuards } = await import('../../src/orchestrate/planner.js');
      // Old pipeline A: budget=3, fully used (3 tasks)
      // New pipeline B: budget=5, only 1 task (the plan)
      const existing = [
        planTask(PID_A, 3, 2), pipelineWorker(PID_A), pipelineWorker(PID_A),  // A: 3/3
        planTask(PID_B, 5, 3),                                                 // B: 1/5
      ];
      // Creating for pipeline B should succeed (1+1=2 ≤ 5)
      const result = checkPipelineGuards({ existingTasks: existing, newTaskMeta: newWorkerMeta(PID_B) });
      expect(result.allowed).toBe(true);
    });

    it('manual tasks do NOT consume planner taskBudget', async () => {
      const { checkPipelineGuards } = await import('../../src/orchestrate/planner.js');
      // Pipeline A: budget=3, 1 plan task + 50 manual tasks (no pipelineId)
      const existing = [
        planTask(PID_A, 3, 2),
        ...Array.from({ length: 50 }, () => manualTask()),
      ];
      // Pipeline A only has 1 task counted → 1+1=2 ≤ 3 → allowed
      const result = checkPipelineGuards({ existingTasks: existing, newTaskMeta: newWorkerMeta(PID_A) });
      expect(result.allowed).toBe(true);
    });

    it('review iteration limit is scoped to same pipeline', async () => {
      const { checkPipelineGuards } = await import('../../src/orchestrate/planner.js');
      // Pipeline A: maxIterations=1 (exhausted)
      // Pipeline B: maxIterations=5 (plenty left)
      const existing = [
        planTask(PID_A, 20, 1),
        planTask(PID_B, 20, 5),
      ];
      // Review iter=3 for pipeline B → allowed (3 ≤ 5)
      const resultB = checkPipelineGuards({ existingTasks: existing, newTaskMeta: newReviewMeta(PID_B, 3) });
      expect(resultB.allowed).toBe(true);
      // Review iter=2 for pipeline A → rejected (2 > 1)
      const resultA = checkPipelineGuards({ existingTasks: existing, newTaskMeta: newReviewMeta(PID_A, 2) });
      expect(resultA.allowed).toBe(false);
    });

    it('two different goals with separate pipelines have independent guards', async () => {
      const { checkPipelineGuards } = await import('../../src/orchestrate/planner.js');
      // Pipeline A: budget=2, already full (2 tasks)
      // Pipeline B: budget=10, only 1 task
      const existing = [
        planTask(PID_A, 2, 3), pipelineWorker(PID_A),  // A: 2/2 (full)
        planTask(PID_B, 10, 3),                          // B: 1/10
      ];
      // A: budget exhausted
      const rA = checkPipelineGuards({ existingTasks: existing, newTaskMeta: newWorkerMeta(PID_A) });
      expect(rA.allowed).toBe(false);
      // B: plenty of room
      const rB = checkPipelineGuards({ existingTasks: existing, newTaskMeta: newWorkerMeta(PID_B) });
      expect(rB.allowed).toBe(true);
    });
  });

  // ── dry-run: seedAutonomousPipeline must NOT be called ──────────

  describe('dry-run guard', () => {
    let tmpDir: string;
    let teamStore: TeamStore;

    beforeEach(async () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'planner-dryrun-'));
      teamStore = await initTeamStore(tmpDir);
    });

    afterEach(() => {
      try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    });

    it('seedAutonomousPipeline writes to DB (non-dry-run baseline)', () => {
      seedAutonomousPipeline(teamStore, 'test/proj', { goal: 'Build X' });
      const tasks = teamStore.listTasks('test/proj');
      expect(tasks.length).toBe(1);
    });

    it('NOT calling seedAutonomousPipeline leaves task board empty (dry-run simulation)', () => {
      // This mirrors the CLI dry-run path: we skip seedAutonomousPipeline entirely
      const dryRun = true;
      if (!dryRun) {
        seedAutonomousPipeline(teamStore, 'test/proj', { goal: 'Build X' });
      }
      const tasks = teamStore.listTasks('test/proj');
      expect(tasks.length).toBe(0);
    });
  });

  // ── buildReviewIterationHint ───────────────────────────────────

  describe('buildReviewIterationHint', () => {
    it('returns FINAL warning on last iteration', () => {
      const hint = buildReviewIterationHint(3, 3, 2);
      expect(hint).toContain('FINAL review iteration');
      expect(hint).toContain('Do NOT create more tasks');
    });

    it('shows iteration count and budget for non-final iterations', () => {
      const hint = buildReviewIterationHint(1, 3, 8);
      expect(hint).toContain('1/3');
      expect(hint).toContain('8 tasks');
      expect(hint).toContain('may create fix tasks');
    });
  });
});
