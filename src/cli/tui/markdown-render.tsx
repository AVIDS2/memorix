/**
 * Lightweight Markdown renderer for Ink TUI.
 *
 * Parses markdown text and renders it using Ink's <Text> component
 * with bold/italic/color support. No external dependencies.
 *
 * Supported:
 * - **bold** → <Text bold>
 * - *italic* → <Text italic>
 * - `inline code` → <Text color="cyan">
 * - # ## ### headings → <Text bold color="brand">
 * - - unordered lists → bullet + indent
 * - 1. ordered lists → number + indent
 * - > blockquotes → <Text color="muted"> with │ prefix
 * - [obs:N] citation links → <Text color="brand">
 * - --- horizontal rules → ─── separator
 */

import React from 'react';
import { Box, Text } from 'ink';

// ── Inline markdown tokenizer ────────────────────────────────────

interface InlineToken {
  type: 'text' | 'bold' | 'italic' | 'code' | 'citation';
  content: string;
}

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;

  while (i < text.length) {
    // **bold**
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        tokens.push({ type: 'bold', content: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    // *italic* (but not **)
    if (text[i] === '*' && text[i + 1] !== '*' && i > 0 && text[i - 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      if (end !== -1 && text[end + 1] !== '*') {
        tokens.push({ type: 'italic', content: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // `inline code`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        tokens.push({ type: 'code', content: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // [obs:N] citation
    const citationMatch = text.slice(i).match(/^\[obs:(\d+)\]/);
    if (citationMatch) {
      tokens.push({ type: 'citation', content: citationMatch[0] });
      i += citationMatch[0].length;
      continue;
    }

    // Accumulate plain text
    let plain = '';
    while (i < text.length) {
      if (
        (text[i] === '*' && text[i + 1] === '*') ||
        (text[i] === '*' && text[i + 1] !== '*') ||
        text[i] === '`' ||
        text.slice(i).startsWith('[obs:')
      ) break;
      plain += text[i];
      i++;
    }
    if (plain) tokens.push({ type: 'text', content: plain });
  }

  return tokens;
}

// ── Block-level parser ───────────────────────────────────────────

interface BlockNode {
  type: 'heading' | 'paragraph' | 'list' | 'blockquote' | 'hr' | 'code_block';
  level?: number;          // heading level 1-3
  items?: string[];        // list items
  ordered?: boolean;       // ordered list?
  content?: string;        // paragraph/heading/blockquote content
  language?: string;       // code block language
}

function parseBlocks(text: string): BlockNode[] {
  const lines = text.split('\n');
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // Code block (fenced)
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        type: 'code_block',
        language: lang || undefined,
        content: codeLines.join('\n'),
      });
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', content: quoteLines.join('\n') });
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line.trimStart())) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trimStart())) {
        items.push(lines[i].trimStart().replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line.trimStart())) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trimStart())) {
        items.push(lines[i].trimStart().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // Empty line — skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — accumulate consecutive non-empty lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('#') && !lines[i].startsWith('>') && !lines[i].startsWith('```') && !/^[-*]\s+/.test(lines[i].trimStart()) && !/^\d+\.\s+/.test(lines[i].trimStart())) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', content: paraLines.join(' ') });
    }
  }

  return blocks;
}

// ── Colors ───────────────────────────────────────────────────────

const COLORS = {
  brand: '#6C9BD2',
  heading: '#89B4FA',
  code: '#94E2D5',
  codeBlock: '#6C7086',
  quote: '#585B70',
  citation: '#6C9BD2',
  bullet: '#89B4FA',
  hr: '#45475A',
  text: '#CAD3F5',
};

// ── Rendering ────────────────────────────────────────────────────

function renderInlineTokens(tokens: InlineToken[]): React.ReactElement[] {
  return tokens.map((token, idx) => {
    switch (token.type) {
      case 'bold':
        return <Text key={idx} bold>{token.content}</Text>;
      case 'italic':
        return <Text key={idx} italic>{token.content}</Text>;
      case 'code':
        return <Text key={idx} color={COLORS.code}>{token.content}</Text>;
      case 'citation':
        return <Text key={idx} color={COLORS.citation} bold>{token.content}</Text>;
      default:
        return <Text key={idx}>{token.content}</Text>;
    }
  });
}

function renderBlock(block: BlockNode, key: number, maxWidth: number): React.ReactElement {
  switch (block.type) {
    case 'heading':
      return (
        <Text key={key} bold color={COLORS.heading} wrap="truncate-end">
          {'#'.repeat(block.level ?? 1) + ' '}
          {renderInlineTokens(tokenizeInline(block.content ?? ''))}
        </Text>
      );

    case 'paragraph': {
      // CJK-aware wrapping: split text by display width, render each line
      const lines = cjkAwareLines(block.content ?? '', maxWidth);
      return (
        <Box key={key} flexDirection="column">
          {lines.map((ln, i) => (
            <Text key={i}>{renderInlineTokens(tokenizeInline(ln))}</Text>
          ))}
        </Box>
      );
    }

    case 'blockquote': {
      const lines = cjkAwareLines(block.content ?? '', maxWidth - 2);
      return (
        <Box key={key} flexDirection="column">
          {lines.map((ln, i) => (
            <Text key={i} color={COLORS.quote}>{'│ '}{ln}</Text>
          ))}
        </Box>
      );
    }

    case 'hr':
      return (
        <Text key={key} color={COLORS.hr}>{'─'.repeat(Math.min(40, maxWidth))}</Text>
      );

    case 'list': {
      const items = block.items ?? [];
      const prefixLen = block.ordered ? 3 : 2;
      return (
        <React.Fragment key={key}>
          {items.map((item, idx) => {
            const lines = cjkAwareLines(item, maxWidth - prefixLen);
            return (
              <Box key={idx} flexDirection="column">
                {lines.map((ln, li) => (
                  <Text key={li}>
                    {li === 0 && <Text color={COLORS.bullet}>{block.ordered ? `${idx + 1}. ` : '• '}</Text>}
                    {li > 0 && <Text>{' '.repeat(prefixLen)}</Text>}
                    {renderInlineTokens(tokenizeInline(ln))}
                  </Text>
                ))}
              </Box>
            );
          })}
        </React.Fragment>
      );
    }

    case 'code_block': {
      const lines = cjkAwareLines(block.content ?? '', maxWidth);
      return (
        <Box key={key} flexDirection="column">
          {lines.map((ln, i) => (
            <Text key={i} color={COLORS.codeBlock}>{ln}</Text>
          ))}
        </Box>
      );
    }

    default:
      return <Text key={key} />;
  }
}

interface MarkdownProps {
  children: string;
  /** Max display width for CJK-aware line wrapping. Defaults to 80. */
  maxWidth?: number;
}

/** Measure display width counting CJK chars as 2 columns. */
function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3040 && cp <= 0x30FF) ||
        (cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0xFF01 && cp <= 0xFF60) ||
        (cp >= 0x3400 && cp <= 0x4DBF)) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** Split text into lines respecting CJK double-width characters. */
function cjkAwareLines(text: string, maxCols: number): string[] {
  if (maxCols < 4) return [text];
  const lines: string[] = [];
  let line = '';
  let lineW = 0;
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(line);
      line = '';
      lineW = 0;
      continue;
    }
    const cw = displayWidth(ch);
    if (lineW + cw > maxCols && line.length > 0) {
      lines.push(line);
      line = ch;
      lineW = cw;
    } else {
      line += ch;
      lineW += cw;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

/**
 * Render markdown text in the terminal using Ink components.
 * Uses CJK-aware line wrapping instead of Ink's wrap="wrap"
 * which doesn't understand double-width CJK characters.
 */
export function Markdown({ children, maxWidth = 80 }: MarkdownProps): React.ReactElement {
  const blocks = parseBlocks(children);

  return (
    <React.Fragment>
      {blocks.map((block, idx) => renderBlock(block, idx, maxWidth))}
    </React.Fragment>
  );
}
