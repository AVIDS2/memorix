/**
 * Entity Extractor Tests
 *
 * Tests regex-based entity extraction from observation content.
 * Inspired by MemCP's RegexEntityExtractor.
 */

import { describe, it, expect } from 'vitest';
import { extractEntities, enrichConcepts } from '../../src/memory/entity-extractor.js';

describe('Entity Extractor', () => {
  describe('extractEntities', () => {
    it('should extract file paths', () => {
      const result = extractEntities('Fixed bug in src/auth/jwt.ts and updated ./config.json');
      expect(result.files).toContain('src/auth/jwt.ts');
      expect(result.files).toContain('./config.json');
    });

    it('should extract module/package paths', () => {
      const result = extractEntities('Using @orama/orama for search and memcp.core.graph for graph');
      expect(result.modules).toContain('@orama/orama');
      expect(result.modules).toContain('memcp.core.graph');
    });

    it('should extract URLs', () => {
      const result = extractEntities('API docs at https://api.example.com/v1/docs');
      expect(result.urls).toContain('https://api.example.com/v1/docs');
    });

    it('should extract @mentions', () => {
      const result = extractEntities('Reviewed by @alice and @bob_dev');
      expect(result.mentions).toContain('alice');
      expect(result.mentions).toContain('bob_dev');
    });

    it('should extract CamelCase identifiers', () => {
      const result = extractEntities('The KnowledgeGraphManager uses WorkspaceSyncEngine');
      expect(result.identifiers).toContain('KnowledgeGraphManager');
      expect(result.identifiers).toContain('WorkspaceSyncEngine');
    });

    it('should deduplicate entities', () => {
      const result = extractEntities('src/auth.ts and src/auth.ts again');
      const authCount = result.files.filter((f) => f === 'src/auth.ts').length;
      expect(authCount).toBeLessThanOrEqual(1);
    });

    it('should detect causal language', () => {
      expect(extractEntities('Chose JWT because it is stateless').hasCausalLanguage).toBe(true);
      expect(extractEntities('Fixed the bug due to race condition').hasCausalLanguage).toBe(true);
      expect(extractEntities('Updated the config file').hasCausalLanguage).toBe(false);
    });

    it('should ignore very short entities', () => {
      const result = extractEntities('a.b is too short');
      // Entities < 3 chars should be filtered
      expect(result.files).not.toContain('a.b');
    });

    it('should extract Chinese identifiers in brackets', () => {
      const result = extractEntities('修改了「认证模块」的逻辑，更新了【数据库连接】配置');
      expect(result.identifiers).toContain('认证模块');
      expect(result.identifiers).toContain('数据库连接');
    });

    it('should extract Chinese identifiers in backticks', () => {
      const result = extractEntities('调用 `用户管理` 接口获取 `权限验证` 结果');
      expect(result.identifiers).toContain('用户管理');
      expect(result.identifiers).toContain('权限验证');
    });

    it('should detect Chinese causal language', () => {
      expect(extractEntities('因为性能问题所以改用了缓存').hasCausalLanguage).toBe(true);
      expect(extractEntities('由于兼容性问题决定采用新方案').hasCausalLanguage).toBe(true);
      expect(extractEntities('更新了配置文件').hasCausalLanguage).toBe(false);
    });
  });

  describe('enrichConcepts', () => {
    it('should add file names as concepts', () => {
      const extracted = extractEntities('Changed src/auth/jwt.ts');
      const enriched = enrichConcepts(['auth'], extracted);
      expect(enriched).toContain('auth');
      expect(enriched).toContain('jwt');
    });

    it('should add CamelCase identifiers as concepts', () => {
      const extracted = extractEntities('Used KnowledgeGraphManager');
      const enriched = enrichConcepts([], extracted);
      expect(enriched).toContain('KnowledgeGraphManager');
    });

    it('should not duplicate existing concepts', () => {
      const extracted = extractEntities('Used KnowledgeGraphManager');
      const enriched = enrichConcepts(['KnowledgeGraphManager'], extracted);
      const count = enriched.filter((c) => c === 'KnowledgeGraphManager').length;
      expect(count).toBe(1);
    });

    it('should be case-insensitive for dedup', () => {
      const extracted = extractEntities('Changed src/auth/jwt.ts');
      const enriched = enrichConcepts(['JWT'], extracted);
      // 'jwt' from file should not be added since 'JWT' already exists
      expect(enriched.filter((c) => c.toLowerCase() === 'jwt').length).toBe(1);
    });
  });
});
