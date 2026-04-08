/**
 * Bottom input bar with slash-command palette.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS, SLASH_COMMANDS } from './theme.js';
import type { SlashCommand } from './theme.js';

interface CommandBarProps {
  onSubmit: (input: string) => void;
  onExit: () => void;
  disabled?: boolean;
  disabledHint?: string;
  onFocusChange?: (focused: boolean) => void;
}

export function CommandBar({
  onSubmit,
  onExit,
  disabled = false,
  disabledHint = 'Action view active',
  onFocusChange,
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
          // Enter on palette = execute the command directly
          setInput('');
          setCursorPos(0);
          setPaletteIndex(0);
          onSubmit(selected.name);
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

    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setInput((prev) => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
        setCursorPos((prev) => prev - 1);
        setPaletteIndex(0);
      }
      return;
    }

    if (key.leftArrow) {
      setCursorPos((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorPos((prev) => Math.min(input.length, prev + 1));
      return;
    }

    if (ch && !key.ctrl && !key.meta) {
      setInput((prev) => prev.slice(0, cursorPos) + ch + prev.slice(cursorPos));
      setCursorPos((prev) => prev + 1);
      setPaletteIndex(0);
    }
  });

  return (
    <Box flexDirection="column">
      {showPalette && filteredCommands.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={COLORS.border}
          paddingX={1}
          marginX={1}
        >
          <Text color={COLORS.accentDim} bold>Commands</Text>
          {filteredCommands.map((command, index) => (
            <Box key={command.name}>
              <Text color={index === clampedIndex ? COLORS.accent : COLORS.text} bold={index === clampedIndex}>
                {index === clampedIndex ? '> ' : '  '}
                {command.name.padEnd(16)}
              </Text>
              <Text color={COLORS.muted}>{command.description}</Text>
              {command.alias && <Text color={COLORS.textDim}> ({command.alias})</Text>}
            </Box>
          ))}
          <Text color={COLORS.muted}>Up/Down navigate | Tab complete | Enter execute</Text>
        </Box>
      )}

      <Box
        borderStyle="single"
        borderColor={input.startsWith('/') ? COLORS.accent : COLORS.border}
        paddingX={1}
        marginX={1}
      >
        {disabled ? (
          <>
            <Text color={COLORS.accent} bold>{'>'}</Text>
            <Text color={COLORS.muted}>{disabledHint}</Text>
          </>
        ) : (
          <>
            <Text color={COLORS.accent} bold>{'> '}</Text>
            <Text color={COLORS.text}>{input.slice(0, cursorPos)}</Text>
            <Text backgroundColor={COLORS.accent} color={COLORS.bg}>{input[cursorPos] || ' '}</Text>
            <Text color={COLORS.text}>{input.slice(cursorPos + 1)}</Text>
            {!input && <Text color={COLORS.muted}> search memories or /command</Text>}
          </>
        )}
      </Box>
    </Box>
  );
}
