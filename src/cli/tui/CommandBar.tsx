/**
 * CommandBar — Bottom input bar with slash command palette
 *
 * Fixed at bottom. Supports text input and slash command autocomplete.
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS, SLASH_COMMANDS } from './theme.js';
import type { SlashCommand } from './theme.js';

interface CommandBarProps {
  onSubmit: (input: string) => void;
  onExit: () => void;
}

export function CommandBar({ onSubmit, onExit }: CommandBarProps): React.ReactElement {
  const [input, setInput] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [paletteIndex, setPaletteIndex] = useState(0);

  // Compute filtered commands for palette
  const showPalette = input.startsWith('/') && !input.includes(' ');
  const filteredCommands: SlashCommand[] = showPalette
    ? SLASH_COMMANDS.filter(c =>
        c.name.startsWith(input.toLowerCase()) ||
        (c.alias && c.alias.startsWith(input.toLowerCase()))
      )
    : [];
  const clampedIndex = Math.min(paletteIndex, Math.max(0, filteredCommands.length - 1));

  useInput((ch, key) => {
    // Ctrl+C — exit
    if (key.ctrl && ch === 'c') {
      onExit();
      return;
    }

    // Escape — clear input or close palette
    if (key.escape) {
      if (showPalette) {
        setInput('');
        setCursorPos(0);
      } else if (input) {
        setInput('');
        setCursorPos(0);
      }
      return;
    }

    // Arrow up/down in palette
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

    // Tab — autocomplete from palette
    if (key.tab && showPalette && filteredCommands.length > 0) {
      const selected = filteredCommands[clampedIndex];
      if (selected) {
        const newInput = selected.name + ' ';
        setInput(newInput);
        setCursorPos(newInput.length);
        setPaletteIndex(0);
      }
      return;
    }

    // Enter — submit or accept palette selection
    if (key.return) {
      if (showPalette && filteredCommands.length > 0) {
        const selected = filteredCommands[clampedIndex];
        if (selected) {
          const newInput = selected.name + ' ';
          setInput(newInput);
          setCursorPos(newInput.length);
          setPaletteIndex(0);
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

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setInput(prev => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
        setCursorPos(prev => prev - 1);
        setPaletteIndex(0);
      }
      return;
    }

    // Left/Right arrow for cursor movement
    if (key.leftArrow) {
      setCursorPos(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorPos(prev => Math.min(input.length, prev + 1));
      return;
    }

    // Printable character
    if (ch && !key.ctrl && !key.meta) {
      setInput(prev => prev.slice(0, cursorPos) + ch + prev.slice(cursorPos));
      setCursorPos(prev => prev + 1);
      setPaletteIndex(0);
    }
  });

  return (
    <Box flexDirection="column">
      {/* Command Palette -- floats above input, OpenCode style */}
      {showPalette && filteredCommands.length > 0 && (
        <Box
          flexDirection="column"
          marginX={2}
          marginBottom={0}
        >
          {filteredCommands.map((cmd, i) => {
            const selected = i === clampedIndex;
            return (
              <Box key={cmd.name}>
                <Text
                  color={selected ? COLORS.text : COLORS.muted}
                  bold={selected}
                  backgroundColor={selected ? '#3a3a3a' : undefined}
                >
                  {' '}{cmd.name.padEnd(14)}{' '}
                </Text>
                <Text color={selected ? COLORS.text : COLORS.muted}>
                  {' '}{cmd.description}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Input area -- left accent border, OpenCode style */}
      <Box marginX={1} paddingLeft={1}>
        <Text color={COLORS.accent}>{'|'} </Text>
        <Text color={COLORS.text}>
          {input || ''}
        </Text>
        <Text color={COLORS.muted}>
          {input ? '' : 'Search memory or type /command'}
        </Text>
      </Box>
    </Box>
  );
}
