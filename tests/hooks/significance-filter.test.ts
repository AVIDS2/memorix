/**
 * Significance Filter Tests
 *
 * Ensures the noise filter correctly identifies:
 * - Technical content that SHOULD be stored
 * - Trivial content that should be SKIPPED
 */

import { describe, it, expect } from 'vitest';
import {
  isSignificantKnowledge,
  isRetrievedResult,
  isTrivialCommand,
} from '../../src/hooks/significance-filter.js';

describe('isSignificantKnowledge', () => {
  describe('should ACCEPT technical content', () => {
    it('accepts code blocks', () => {
      const result = isSignificantKnowledge('Here is the fix:\n```typescript\nconst x = 1;\n```');
      expect(result.isSignificant).toBe(true);
      expect(result.reason).toBe('technical_pattern');
    });

    it('accepts inline code', () => {
      const result = isSignificantKnowledge('Use `npm install` to install dependencies');
      expect(result.isSignificant).toBe(true);
    });

    it('accepts programming concepts', () => {
      const result = isSignificantKnowledge('The function uses async/await for better performance');
      expect(result.isSignificant).toBe(true);
    });

    it('accepts error messages', () => {
      const result = isSignificantKnowledge('TypeError: Cannot read property of undefined');
      expect(result.isSignificant).toBe(true);
    });

    it('accepts architecture decisions', () => {
      const result = isSignificantKnowledge('We chose JWT because it allows stateless authentication');
      expect(result.isSignificant).toBe(true);
    });

    it('accepts Chinese technical content', () => {
      const result = isSignificantKnowledge('这个函数使用异步回调来处理请求');
      expect(result.isSignificant).toBe(true);
    });

    it('accepts deployment discussions', () => {
      const result = isSignificantKnowledge('Deploy to production using Docker container on AWS');
      expect(result.isSignificant).toBe(true);
    });

    it('accepts database discussions', () => {
      const result = isSignificantKnowledge('Add an index on the user_id column for better query performance');
      expect(result.isSignificant).toBe(true);
    });

    it('accepts substantial length content', () => {
      // Use non-technical content to test length-based acceptance
      const longContent = 'The quick brown fox jumps over the lazy dog near the river bank. '.repeat(5);
      const result = isSignificantKnowledge(longContent);
      expect(result.isSignificant).toBe(true);
      // May match via length or density - both are valid
      expect(['substantial_length', 'moderate_technical_density']).toContain(result.reason);
    });

    it('accepts code-like patterns', () => {
      const result = isSignificantKnowledge('user.getName() returns the full name');
      expect(result.isSignificant).toBe(true);
    });
  });

  describe('should REJECT trivial content', () => {
    it('rejects empty content', () => {
      expect(isSignificantKnowledge('').isSignificant).toBe(false);
      expect(isSignificantKnowledge('   ').isSignificant).toBe(false);
      expect(isSignificantKnowledge(null as unknown as string).isSignificant).toBe(false);
    });

    it('rejects greetings', () => {
      expect(isSignificantKnowledge('Hello!').isSignificant).toBe(false);
      expect(isSignificantKnowledge('Thanks for your help').isSignificant).toBe(false);
      expect(isSignificantKnowledge('你好').isSignificant).toBe(false);
    });

    it('rejects simple acknowledgments', () => {
      expect(isSignificantKnowledge('Yes').isSignificant).toBe(false);
      expect(isSignificantKnowledge('OK').isSignificant).toBe(false);
      expect(isSignificantKnowledge('好的').isSignificant).toBe(false);
    });

    it('rejects status messages', () => {
      expect(isSignificantKnowledge('Task completed').isSignificant).toBe(false);
      expect(isSignificantKnowledge('Done').isSignificant).toBe(false);
      expect(isSignificantKnowledge('完成').isSignificant).toBe(false);
    });

    it('rejects very short content', () => {
      expect(isSignificantKnowledge('abc').isSignificant).toBe(false);
      expect(isSignificantKnowledge('test').isSignificant).toBe(false);
    });

    it('rejects tool result prefixes', () => {
      expect(isSignificantKnowledge('memorix_search: found 5 results').isSignificant).toBe(false);
    });
  });

  describe('confidence scoring', () => {
    it('has high confidence for skip patterns', () => {
      const result = isSignificantKnowledge('Hello!');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('has high confidence for technical patterns', () => {
      const result = isSignificantKnowledge('The async function returns a Promise');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('has lower confidence for length-based decisions', () => {
      const longContent = 'This is some content that is long enough. '.repeat(6);
      const result = isSignificantKnowledge(longContent);
      expect(result.confidence).toBeLessThan(0.7);
    });
  });
});

describe('isRetrievedResult', () => {
  it('detects memorix search results', () => {
    expect(isRetrievedResult('memorix_search: found 3 results')).toBe(true);
    expect(isRetrievedResult('memorix_detail: observation #42')).toBe(true);
  });

  it('detects observation references', () => {
    expect(isRetrievedResult('Observation #123: Some memory')).toBe(true);
    expect(isRetrievedResult('Stored observation #456')).toBe(true);
  });

  it('does not flag normal content', () => {
    expect(isRetrievedResult('I found a bug in the code')).toBe(false);
    expect(isRetrievedResult('The search function works well')).toBe(false);
  });

  it('handles edge cases', () => {
    expect(isRetrievedResult('')).toBe(false);
    expect(isRetrievedResult(null as unknown as string)).toBe(false);
  });
});

describe('isTrivialCommand', () => {
  it('detects navigation commands', () => {
    expect(isTrivialCommand('ls -la')).toBe(true);
    expect(isTrivialCommand('cd /home/user')).toBe(true);
    expect(isTrivialCommand('pwd')).toBe(true);
  });

  it('detects git inspection commands', () => {
    expect(isTrivialCommand('git status')).toBe(true);
    expect(isTrivialCommand('git log')).toBe(true);
    expect(isTrivialCommand('git diff')).toBe(true);
  });

  it('detects npm inspection commands', () => {
    expect(isTrivialCommand('npm list')).toBe(true);
    expect(isTrivialCommand('npm outdated')).toBe(true);
  });

  it('does NOT flag meaningful commands', () => {
    expect(isTrivialCommand('npm install express')).toBe(false);
    expect(isTrivialCommand('git commit -m "fix bug"')).toBe(false);
    expect(isTrivialCommand('docker build -t myapp .')).toBe(false);
  });

  it('handles edge cases', () => {
    expect(isTrivialCommand('')).toBe(true);
    expect(isTrivialCommand(null as unknown as string)).toBe(true);
  });
});

describe('performance', () => {
  it('processes content quickly', () => {
    const content = 'This is a test of the significance filter with some technical content like async/await and Promise handling.';
    const iterations = 1000;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      isSignificantKnowledge(content);
    }
    const elapsed = performance.now() - start;

    // Should process 1000 iterations in under 100ms (0.1ms per call)
    expect(elapsed).toBeLessThan(100);
  });
});
