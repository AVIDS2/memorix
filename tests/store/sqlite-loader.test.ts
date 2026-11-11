import { describe, expect, it } from 'vitest';
import { loadSqlite } from '../../src/store/bun-sqlite-compat.js';

describe('SQLite compatibility loader', () => {
  it('loads better-sqlite3 from ESM modules without relying on a global require', () => {
    const Database = loadSqlite();
    expect(typeof Database).toBe('function');
  });
});
