import { describe, expect, it } from 'vitest';

import { assessHookAdmission } from '../../src/hooks/admission.js';
import type { NormalizedHookInput } from '../../src/hooks/types.js';

function hook(overrides: Partial<NormalizedHookInput> = {}): NormalizedHookInput {
  return {
    event: 'post_tool',
    agent: 'claude',
    timestamp: '2026-07-24T00:00:00.000Z',
    sessionId: 'session-1',
    cwd: 'C:/workspace/project',
    raw: {},
    ...overrides,
  };
}

describe('hook admission', () => {
  it('keeps a routine successful test as an ephemeral trace', () => {
    const decision = assessHookAdmission({
      hook: hook({ command: 'npm test' }),
      category: 'command',
      content: 'Command: npm test\nTests 17 passed (17)\nTest Files 2 passed (2)',
      observationType: 'discovery',
    });

    expect(decision).toEqual(expect.objectContaining({
      action: 'store',
      admissionState: 'ephemeral',
      valueCategory: 'ephemeral',
    }));
  });

  it('keeps a focused failed validation as a candidate', () => {
    const decision = assessHookAdmission({
      hook: hook({ command: 'npx vitest run tests/auth.test.ts' }),
      category: 'command',
      content: 'Command: npx vitest run tests/auth.test.ts\nFAIL tests/auth.test.ts: expected 200, received 401',
      observationType: 'problem-solution',
    });

    expect(decision).toEqual(expect.objectContaining({
      action: 'store',
      admissionState: 'candidate',
      valueCategory: 'contextual',
    }));
  });

  it('keeps a concrete file mutation as a candidate instead of directly durable memory', () => {
    const decision = assessHookAdmission({
      hook: hook({
        event: 'post_edit',
        filePath: 'src/auth.ts',
        edits: [{ oldString: 'return false;', newString: 'return verifyToken(token);' }],
      }),
      category: 'file_modify',
      content: 'File: src/auth.ts\nEdit: return false; -> return verifyToken(token);',
      observationType: 'what-changed',
    });

    expect(decision).toEqual(expect.objectContaining({
      action: 'store',
      admissionState: 'candidate',
      valueCategory: 'contextual',
    }));
  });

  it('keeps a concise technical assistant response as a candidate', () => {
    const decision = assessHookAdmission({
      hook: hook({
        event: 'post_response',
        aiResponse: 'Implemented token rotation and refreshed the auth cache after successful validation.',
      }),
      category: 'unknown',
      content: 'Implemented token rotation and refreshed the auth cache after successful validation.',
      observationType: 'discovery',
    });

    expect(decision).toEqual(expect.objectContaining({
      action: 'store',
      admissionState: 'candidate',
      valueCategory: 'contextual',
    }));
  });

  it('drops a non-technical assistant acknowledgment', () => {
    expect(assessHookAdmission({
      hook: hook({ event: 'post_response', aiResponse: 'Thanks, I will take care of it.' }),
      category: 'unknown',
      content: 'Thanks, I will take care of it.',
      observationType: 'discovery',
    })).toEqual(expect.objectContaining({ action: 'drop' }));
  });

  it('drops a non-technical conversational prompt', () => {
    expect(assessHookAdmission({
      hook: hook({ event: 'user_prompt', userPrompt: 'Could you take a look when you have time?' }),
      category: 'unknown',
      content: 'Could you take a look when you have time?',
      observationType: 'discovery',
    })).toEqual(expect.objectContaining({ action: 'drop' }));
  });
});
