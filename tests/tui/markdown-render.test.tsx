import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Markdown } from '../../src/cli/tui/markdown-render.js';

describe('Markdown renderer', () => {
  it('renders plain text unchanged', () => {
    const { lastFrame } = render(<Markdown>Hello world</Markdown>);
    expect(lastFrame()).toContain('Hello world');
  });

  it('renders bold text', () => {
    const { lastFrame } = render(<Markdown>This is **bold** text</Markdown>);
    expect(lastFrame()).toContain('bold');
  });

  it('renders inline code', () => {
    const { lastFrame } = render(<Markdown>Use `npm install` to install</Markdown>);
    expect(lastFrame()).toContain('npm install');
  });

  it('renders headings with # prefix', () => {
    const { lastFrame } = render(<Markdown>{'# Title\nSome content'}</Markdown>);
    expect(lastFrame()).toContain('Title');
    expect(lastFrame()).toContain('#');
  });

  it('renders unordered list items', () => {
    const { lastFrame } = render(<Markdown>{'- Item one\n- Item two'}</Markdown>);
    expect(lastFrame()).toContain('Item one');
    expect(lastFrame()).toContain('Item two');
  });

  it('renders citation links [obs:N]', () => {
    const { lastFrame } = render(<Markdown>See [obs:42] for details</Markdown>);
    expect(lastFrame()).toContain('[obs:42]');
  });

  it('renders horizontal rules', () => {
    const { lastFrame } = render(<Markdown>{'Above\n---\nBelow'}</Markdown>);
    expect(lastFrame()).toContain('Above');
    expect(lastFrame()).toContain('Below');
  });

  it('renders blockquotes with │ prefix', () => {
    const { lastFrame } = render(<Markdown>{'> This is a quote'}</Markdown>);
    expect(lastFrame()).toContain('This is a quote');
  });

  it('renders code blocks', () => {
    const { lastFrame } = render(<Markdown>{'```js\nconsole.log("hi")\n```'}</Markdown>);
    expect(lastFrame()).toContain('console.log');
  });
});
