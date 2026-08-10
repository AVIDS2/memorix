import { describe, expect, it } from 'vitest';
import { parseFrontmatter, stringifyFrontmatter } from '../../src/utils/frontmatter.js';

describe('frontmatter', () => {
  it('parses YAML front matter without changing the Markdown body', () => {
    expect(parseFrontmatter('---\ntitle: Release\ntags:\n  - npm\n---\n# Notes\n'))
      .toEqual({ data: { title: 'Release', tags: ['npm'] }, content: '# Notes\n' });
  });

  it('keeps plain Markdown as content', () => {
    expect(parseFrontmatter('# No metadata\n')).toEqual({ data: {}, content: '# No metadata\n' });
  });

  it('writes a document that can be parsed back into the same fields', () => {
    const rendered = stringifyFrontmatter('body\n', { description: 'Safe YAML' });
    expect(parseFrontmatter(rendered)).toEqual({ data: { description: 'Safe YAML' }, content: 'body\n' });
  });
});
