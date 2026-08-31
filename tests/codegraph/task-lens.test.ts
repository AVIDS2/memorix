import { describe, expect, it } from 'vitest';
import { isContinuationTask, resolveTaskLens } from '../../src/codegraph/task-lens.js';

describe('task lens routing', () => {
  it('does not treat a prohibited publish command as release intent', () => {
    const task = 'You have just joined this repository to decide what should happen next after an authentication retry incident. Work like a careful maintainer: establish the current project state, identify the safest next action and its verification, and then assess whether the available project context was sufficient, missing, or noisy. Do not edit files, change settings, or run publish commands.';

    expect(resolveTaskLens(task).id).toBe('bugfix');
  });

  it('keeps an explicit release request as release when publishing is deferred', () => {
    expect(resolveTaskLens('Prepare the 1.2.1 release, but do not publish until maintainer approval.').id).toBe('release');
    expect(resolveTaskLens('Do not publish, but prepare the 1.2.1 release plan.').id).toBe('release');
    expect(resolveTaskLens('\u51c6\u5907 1.2.1 \u53d1\u7248\uff0c\u4f46\u4e0d\u8981\u7acb\u5373\u53d1\u5e03\u3002').id).toBe('release');
    expect(resolveTaskLens('\u4e0d\u8981\u53d1\u5e03\uff0c\u4f46\u5148\u51c6\u5907 1.2.1 \u53d1\u7248\u8ba1\u5212\u3002').id).toBe('release');
  });

  it('does not promote a Chinese no-publish instruction to release', () => {
    expect(resolveTaskLens('\u4e0d\u8981\u53d1\u5e03\uff0c\u5148\u6392\u67e5\u8ba4\u8bc1\u6545\u969c\u5e76\u8fd0\u884c\u5b9a\u5411\u6d4b\u8bd5\u3002').id).toBe('bugfix');
  });

  it('keeps continuation delivery separate from the underlying task lens', () => {
    expect(isContinuationTask('Continue fixing the authentication timeout.')).toBe(true);
    expect(resolveTaskLens('Continue fixing the authentication timeout.').id).toBe('bugfix');
    expect(isContinuationTask('请接手上次留下的登录问题。')).toBe(true);
    expect(isContinuationTask('Document the current worker API.')).toBe(false);
  });

  it('ignores a bare continuation filler with no task to continue', () => {
    // The single most common thing a user types to mean "go on". Matching it
    // would buy a full prior-work brief on nearly every turn — 2-3x the cost of
    // an ordinary prompt, enough to blow the 10s UserPromptSubmit hook budget.
    for (const filler of [
      '继续',
      '继续吧',
      '任务继续',
      '请继续',
      '继续一下',
      'continue',
      'continue please',
      'resume',
      'carry on',
    ]) {
      expect(isContinuationTask(filler)).toBe(false);
    }
  });

  it('still detects an everyday continuation verb carrying a real task', () => {
    // Documented usage: `memorix resume "继续处理发布阻塞问题"`.
    for (const withTask of [
      '继续修复',
      '继续优化',
      '继续 API',
      '继续一下修复',
      'resume bug',
      'resume API',
      'Continue API',
      'pick up API',
      '恢复服务',
      '延续迁移',
      '继续处理发布阻塞问题',
      '继续 JWT refresh 的灰度发布',
      'Continue the JWT refresh rollout safely. Do not modify any files.',
      'resume the migration we paused yesterday',
    ]) {
      expect(isContinuationTask(withTask)).toBe(true);
    }
  });

  it('does not count filler words as a substantive continuation task', () => {
    for (const filler of [
      '继续任务',
      '继续工作',
      '继续接着',
      'continue the',
      'resume please',
    ]) {
      expect(isContinuationTask(filler)).toBe(false);
    }
  });

  it('treats explicit handoff vocabulary as intent on its own', () => {
    for (const explicit of [
      '任务交接',
      '交接',
      '请接手这个项目',
      '上次会话我们做到哪了',
      'handoff',
      'hand off this work',
      'pick up where we left off',
      'previous session context',
    ]) {
      expect(isContinuationTask(explicit)).toBe(true);
    }
  });
});
