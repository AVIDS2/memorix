/**
 * Bottom input bar with slash-command palette.
 *
 * Modern design: brand-colored prompt, Unicode palette styling,
 * status symbols. Commands palette floats as an overlay above
 * the input line using position="absolute" — does not push
 * content down.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS, SLASH_COMMANDS, SEP, SYMBOLS, COMMAND_BAR_ROWS } from './theme.js';
import type { SlashCommand } from './theme.js';

export interface PaletteItem {
  name: string;
  description: string;
  alias?: string;
}

interface CommandBarProps {
  onSubmit: (input: string) => void;
  onExit: () => void;
  disabled?: boolean;
  disabledHint?: string;
  onFocusChange?: (focused: boolean) => void;
  prefixLabel?: string;
  placeholder?: string;
  contentWidth?: number;
  /** Called when palette visibility changes (for scroll key handoff) */
  onPaletteChange?: (visible: boolean) => void;
  /** Called with palette items when they change (for overlay rendering) */
  onPaletteItems?: (items: PaletteItem[], selectedIndex: number) => void;
}

function fit(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text.padEnd(max);
  if (max === 1) return '…';
  return `${text.slice(0, max - 1)}…`;
}

/** Check if a character is fullwidth (CJK, emoji, etc.) — occupies 2 terminal columns */
function isFullwidth(ch: string): boolean {
  if (!ch) return false;
  const cp = ch.codePointAt(0)!;
  // CJK Unified Ideographs
  if (cp >= 0x4E00 && cp <= 0x9FFF) return true;
  // CJK Extension A
  if (cp >= 0x3400 && cp <= 0x4DBF) return true;
  // CJK Compatibility Ideographs
  if (cp >= 0xF900 && cp <= 0xFAFF) return true;
  // CJK Extension B-I
  if (cp >= 0x20000 && cp <= 0x2FA1F) return true;
  // Halfwidth and Fullwidth Forms (fullwidth letters/digits)
  if (cp >= 0xFF01 && cp <= 0xFF60) return true;
  // Hangul Syllables
  if (cp >= 0xAC00 && cp <= 0xD7AF) return true;
  // Katakana / Hiragana
  if (cp >= 0x3040 && cp <= 0x30FF) return true;
  // CJK Symbols and Punctuation
  if (cp >= 0x3000 && cp <= 0x303F) return true;
  // Most emoji are fullwidth
  if (cp >= 0x1F600 && cp <= 0x1F9FF) return true;
  return false;
}

/** Calculate terminal display width of a string */
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += isFullwidth(ch) ? 2 : 1;
  }
  return width;
}

function previousCursorPos(text: string, cursorPos: number): number {
  let start = 0;
  for (const ch of text) {
    const end = start + ch.length;
    if (end >= cursorPos) return start;
    start = end;
  }
  return 0;
}

function nextCursorPos(text: string, cursorPos: number): number {
  let start = 0;
  for (const ch of text) {
    const end = start + ch.length;
    if (start >= cursorPos) return end;
    if (end > cursorPos) return end;
    start = end;
  }
  return text.length;
}

function getCharacterAt(text: string, cursorPos: number): string {
  const codePoint = text.codePointAt(cursorPos);
  return codePoint === undefined ? '' : String.fromCodePoint(codePoint);
}

export function CommandBar({
  onSubmit,
  onExit,
  disabled = false,
  disabledHint = 'Action view active',
  onFocusChange,
  prefixLabel = '[cmd]',
  placeholder = 'type to search or use /command',
  contentWidth = 80,
  onPaletteChange,
  onPaletteItems,
}: CommandBarProps): React.ReactElement {
  const [input, setInput] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [paletteIndex, setPaletteIndex] = useState(0);

  // Notify parent about input focus state for keyboard priority model
  const hasFocus = !disabled && input.length > 0;
  useEffect(() => { onFocusChange?.(hasFocus); }, [hasFocus, onFocusChange]);

  const showPalette = !disabled && input.startsWith('/') && !input.includes(' ');
  const filteredCommands: SlashCommand[] = showPalette
    ? SLASH_COMMANDS.filter((command) =>
        command.name.startsWith(input.toLowerCase()) ||
        (command.alias && command.alias.startsWith(input.toLowerCase())),
      )
    : [];
  const clampedIndex = Math.min(paletteIndex, Math.max(0, filteredCommands.length - 1));

  // Notify parent when palette visibility changes
  useEffect(() => { onPaletteChange?.(showPalette && filteredCommands.length > 0); }, [showPalette, filteredCommands.length, onPaletteChange]);

  // Notify parent about palette items for overlay rendering
  useEffect(() => {
    if (showPalette && filteredCommands.length > 0) {
      onPaletteItems?.(filteredCommands.map(c => ({ name: c.name, description: c.description, alias: c.alias })), clampedIndex);
    } else {
      onPaletteItems?.([], 0);
    }
  }, [showPalette, filteredCommands.length, clampedIndex, onPaletteItems]);

  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') {
      onExit();
      return;
    }

    if (disabled) {
      return;
    }

    if (key.escape) {
      if (showPalette || input) {
        setInput('');
        setCursorPos(0);
      }
      return;
    }

    if (showPalette && filteredCommands.length > 0) {
      if (key.upArrow) {
        setPaletteIndex(Math.max(0, clampedIndex - 1));
        return;
      }
      if (key.downArrow) {
        setPaletteIndex(Math.min(filteredCommands.length - 1, clampedIndex + 1));
        return;
      }
    }

    if (key.tab && showPalette && filteredCommands.length > 0) {
      const selected = filteredCommands[clampedIndex];
      if (selected) {
        const nextInput = `${selected.name} `;
        setInput(nextInput);
        setCursorPos(nextInput.length);
        setPaletteIndex(0);
      }
      return;
    }

    if (key.return) {
      if (showPalette && filteredCommands.length > 0) {
        const selected = filteredCommands[clampedIndex];
        if (selected) {
          // Enter on palette = auto-complete command name + space
          // (like Tab), so user can type arguments before executing.
          // If only one match and it's an arg-less command, execute directly.
          const argLessCommands = new Set(['/home', '/h', '/recent', '/v', '/doctor', '/d', '/project', '/p', '/background', '/bg', '/dashboard', '/dash', '/integrate', '/setup', '/configure', '/config', '/cleanup', '/ingest', '/help', '/?', '/exit', '/quit', '/q', '/clear', '/cc', '/new', '/cn', '/resume', '/cr']);
          if (filteredCommands.length === 1 && argLessCommands.has(selected.name)) {
            setInput('');
            setCursorPos(0);
            setPaletteIndex(0);
            onSubmit(selected.name);
          } else {
            const nextInput = `${selected.name} `;
            setInput(nextInput);
            setCursorPos(nextInput.length);
            setPaletteIndex(0);
          }
        }
      } else if (input.trim()) {
        const submitted = input;
        setInput('');
        setCursorPos(0);
        setPaletteIndex(0);
        onSubmit(submitted);
      }
      return;
    }

    if (key.backspace || ch === '\x7F') {
      if (cursorPos > 0) {
        const prevPos = previousCursorPos(input, cursorPos);
        setInput((prev) => prev.slice(0, prevPos) + prev.slice(cursorPos));
        setCursorPos(prevPos);
        setPaletteIndex(0);
      }
      return;
    }

    if (key.delete) {
      if (cursorPos >= input.length) {
        if (cursorPos > 0) {
          const prevPos = previousCursorPos(input, cursorPos);
          setInput((prev) => prev.slice(0, prevPos) + prev.slice(cursorPos));
          setCursorPos(prevPos);
          setPaletteIndex(0);
        }
      } else {
        const nextPos = nextCursorPos(input, cursorPos);
        setInput((prev) => prev.slice(0, cursorPos) + prev.slice(nextPos));
        setPaletteIndex(0);
      }
      return;
    }

    if (key.leftArrow) {
      setCursorPos((prev) => previousCursorPos(input, prev));
      return;
    }

    if (key.rightArrow) {
      setCursorPos((prev) => nextCursorPos(input, prev));
      return;
    }

    if (ch && !key.ctrl && !key.meta) {
      const nextPos = cursorPos + ch.length;
      setInput((prev) => prev.slice(0, cursorPos) + ch + prev.slice(cursorPos));
      setCursorPos(nextPos);
      setPaletteIndex(0);
    }
  });

  const currentChar = getCharacterAt(input, cursorPos);
  const afterCursor = currentChar ? input.slice(cursorPos + currentChar.length) : '';

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="single"
        borderColor={input.startsWith('/') ? COLORS.brand : COLORS.border}
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
        marginX={1}
      >
        {disabled ? (
          <>
            <Text color={COLORS.brand} bold>[action]</Text>
            <Text color={COLORS.border}> </Text>
            <Text color={COLORS.muted}>{disabledHint}</Text>
          </>
        ) : (
          <>
            <Text color={COLORS.brand} bold>{prefixLabel}</Text>
            <Text color={COLORS.border}> </Text>
            <Text color={COLORS.brand} bold>{`${SYMBOLS.arrow} `}</Text>
            <Text color={COLORS.text}>{input.slice(0, cursorPos)}</Text>
            {currentChar && isFullwidth(currentChar) ? (
              <Text backgroundColor={COLORS.brand} color={COLORS.bg}>{currentChar}</Text>
            ) : (
              <Text backgroundColor={COLORS.brand} color={COLORS.bg}>{currentChar || ' '}</Text>
            )}
            <Text color={COLORS.text}>{afterCursor}</Text>
            {!input && <Text color={COLORS.muted}> {placeholder}</Text>}
          </>
        )}
      </Box>
    </Box>
  );
}
