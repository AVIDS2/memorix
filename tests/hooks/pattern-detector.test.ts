/**
 * Tests for Pattern Detector
 */

import { describe, it, expect } from 'vitest';
import { detectPatterns, detectBestPattern, patternToObservationType } from '../../src/hooks/pattern-detector.js';

describe('Pattern Detector', () => {
  describe('detectPatterns', () => {
    it('should detect decision patterns', () => {
      const content = 'We decided to use PostgreSQL instead of MongoDB because we need ACID transactions. Settled on the approach of using Prisma as ORM.';
      const patterns = detectPatterns(content);
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].type).toBe('decision');
      expect(patterns[0].confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should detect error/fix patterns', () => {
      const content = 'Fixed a critical bug where the authentication token was not being refreshed correctly. The error was caused by a race condition in the token refresh logic. Resolved by adding a mutex lock.';
      const patterns = detectPatterns(content);
      const errorPattern = patterns.find((p) => p.type === 'error');
      expect(errorPattern).toBeDefined();
      expect(errorPattern!.confidence).toBeGreaterThan(0.7);
    });

    it('should detect gotcha patterns', () => {
      const content = 'Watch out: the gradle build path must be set to E:\\gradle instead of the default C:\\Users path. Never use the default path on this machine or it will fail silently.';
      const patterns = detectPatterns(content);
      const gotcha = patterns.find((p) => p.type === 'gotcha');
      expect(gotcha).toBeDefined();
    });

    it('should detect configuration patterns', () => {
      const content = 'Changed the port configuration from 3000 to 3001 because Next.js was already using port 3000. Updated the .env file and docker-compose.yml accordingly.';
      const patterns = detectPatterns(content);
      const config = patterns.find((p) => p.type === 'configuration');
      expect(config).toBeDefined();
    });

    it('should detect Chinese patterns', () => {
      const content = '经过讨论，我们决定采用JWT认证方案来实现用户身份验证，原因是需要无状态认证以支持多服务器部署。选择了jsonwebtoken库来实现token的签发和验证。配置了token过期时间为1小时，刷新token的有效期为7天。这个决策对整个项目架构有重要影响。';
      const patterns = detectPatterns(content);
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns.some((p) => p.type === 'decision')).toBe(true);
    });

    it('should return empty for short content', () => {
      const patterns = detectPatterns('short');
      expect(patterns).toEqual([]);
    });

    it('should return empty for empty content', () => {
      const patterns = detectPatterns('');
      expect(patterns).toEqual([]);
    });
  });

  describe('detectBestPattern', () => {
    it('should return highest confidence pattern', () => {
      const content = 'We decided to fix the critical bug by choosing a new approach. Settled on using a different library after discovering the error was in the old one.';
      const best = detectBestPattern(content);
      expect(best).not.toBeNull();
      expect(best!.confidence).toBeGreaterThan(0.5);
    });

    it('should return null for low confidence', () => {
      const content = 'This is some generic text that does not contain any specific patterns worth detecting for memory purposes whatsoever at all.';
      const best = detectBestPattern(content, 0.9);
      expect(best).toBeNull();
    });
  });

  describe('patternToObservationType', () => {
    it('should map decision → decision', () => {
      expect(patternToObservationType('decision')).toBe('decision');
    });

    it('should map error → problem-solution', () => {
      expect(patternToObservationType('error')).toBe('problem-solution');
    });

    it('should map gotcha → gotcha', () => {
      expect(patternToObservationType('gotcha')).toBe('gotcha');
    });

    it('should map configuration → what-changed', () => {
      expect(patternToObservationType('configuration')).toBe('what-changed');
    });

    it('should map learning → discovery', () => {
      expect(patternToObservationType('learning')).toBe('discovery');
    });

    it('should map implementation → what-changed', () => {
      expect(patternToObservationType('implementation')).toBe('what-changed');
    });
  });
});
