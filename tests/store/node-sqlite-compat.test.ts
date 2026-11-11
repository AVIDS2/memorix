import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, resetSqliteDriverForTests } from '../../src/store/bun-sqlite-compat.js';

describe('node:sqlite compatibility fallback', () => {
  const originalDriver = process.env.MEMORIX_SQLITE_DRIVER;

  afterEach(() => {
    if (originalDriver === undefined) {
      delete process.env.MEMORIX_SQLITE_DRIVER;
    } else {
      process.env.MEMORIX_SQLITE_DRIVER = originalDriver;
    }
    resetSqliteDriverForTests();
  });

  it('keeps better-sqlite3 pragma, statement, and transaction contracts on Node 22', () => {
    process.env.MEMORIX_SQLITE_DRIVER = 'node';
    resetSqliteDriverForTests();
    const db = createDatabase(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      db.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');

      const insert = db.prepare('INSERT INTO entries (value) VALUES (?)');
      const write = db.transaction((values: string[]) => {
        for (const value of values) insert.run(value);
      });
      write(['default']);
      write.deferred(['deferred']);
      write.immediate(['immediate']);
      write.exclusive(['exclusive']);

      expect(db.prepare('SELECT value FROM entries ORDER BY id').all())
        .toEqual([
          { value: 'default' },
          { value: 'deferred' },
          { value: 'immediate' },
          { value: 'exclusive' },
        ]);

      const lookup = db.prepare('SELECT @id AS id');
      expect(lookup.get({ id: 7, projectId: 'unused-row-field' })).toEqual({ id: 7 });
    } finally {
      db.close();
    }
  });
});
