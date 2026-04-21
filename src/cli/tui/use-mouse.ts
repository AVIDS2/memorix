/**
 * useMouse — Ink hook for terminal mouse events via SGR protocol (1006).
 *
 * Enables mouse tracking on mount and parses SGR escape sequences from stdin.
 * Supports left/middle/right click, wheel scroll, and drag.
 * Automatically disables mouse tracking on unmount.
 *
 * Compatible terminals: Windows Terminal, iTerm2, WezTerm, GNOME Terminal,
 * Konsole, MinTTY. NOT compatible with CMD.exe.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useStdin } from 'ink';

export interface MouseEvent {
  /** 0-based column position */
  x: number;
  /** 0-based row position */
  y: number;
  button: 'left' | 'middle' | 'right' | 'wheelUp' | 'wheelDown';
  action: 'press' | 'release' | 'drag';
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

// SGR mouse protocol regex: ESC[<code;col;rowM or ESC[<code;col;rowm
const SGR_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

function toMouseEvent(m: RegExpExecArray): MouseEvent {
  const code = parseInt(m[1], 10);
  const col = parseInt(m[2], 10);
  const row = parseInt(m[3], 10);
  const suffix = m[4];

  const wheel = code & 0b11000000;
  const btnId = code & 0b11;

  const button =
    wheel === 64 ? 'wheelUp' :
    wheel === 65 ? 'wheelDown' :
    btnId === 0 ? 'left' :
    btnId === 1 ? 'middle' :
    'right';

  const action: MouseEvent['action'] =
    wheel !== 0 ? 'press' :
    suffix === 'M' ? 'press' :
    'release';

  const isMotion = !!(code & 0x20);
  const finalAction = isMotion && suffix === 'M' ? 'drag' : action;

  return {
    x: col - 1,
    y: row - 1,
    button,
    action: finalAction,
    shift: !!(code & 4),
    alt: !!(code & 8),
    ctrl: !!(code & 16),
  };
}

export function parseSGRSequence(buf: string): MouseEvent[] {
  const events: MouseEvent[] = [];
  SGR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SGR_RE.exec(buf)) !== null) {
    events.push(toMouseEvent(match));
  }
  return events;
}

export function parseSGRBuffer(buf: string): { events: MouseEvent[]; remainder: string } {
  const events: MouseEvent[] = [];
  SGR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastConsumed = 0;
  while ((match = SGR_RE.exec(buf)) !== null) {
    events.push(toMouseEvent(match));
    lastConsumed = SGR_RE.lastIndex;
  }

  const tail = lastConsumed > 0 ? buf.slice(lastConsumed) : buf;
  const remainderStart = tail.lastIndexOf('\x1b[<');
  return {
    events,
    remainder: remainderStart >= 0 ? tail.slice(remainderStart) : '',
  };
}

// ANSI sequences to enable/disable SGR mouse mode
const ENABLE_SGR = '\x1b[?1006h\x1b[?1000h';
const DISABLE_SGR = '\x1b[?1000l\x1b[?1006l';

export type MouseHandler = (event: MouseEvent) => void;

export interface UseMouseOptions {
  /** Whether mouse tracking is active (default: true) */
  isActive?: boolean;
  /** Whether to manage SGR terminal mode (enable/disable). Set to false when
   *  a parent component centrally manages SGR mode. (default: true) */
  manageMode?: boolean;
}

/**
 * Hook that listens for terminal mouse events using the SGR protocol.
 *
 * Usage:
 * ```tsx
 * useMouse((e) => {
 *   if (e.button === 'left' && e.action === 'press') {
 *     console.log(`Clicked at (${e.x}, ${e.y})`);
 *   }
 * });
 * ```
 */
export function useMouse(handler: MouseHandler, options: UseMouseOptions = {}): void {
  const { isActive = true, manageMode = true } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const bufferRef = useRef('');

  const { stdin } = useStdin();

  const onData = useCallback((data: Buffer | string) => {
    const str = typeof data === 'string' ? data : data.toString('utf8');
    const { events, remainder } = parseSGRBuffer(bufferRef.current + str);
    bufferRef.current = remainder;
    for (const event of events) {
      handlerRef.current(event);
    }
  }, []);

  useEffect(() => {
    if (!isActive || !stdin) return;
    bufferRef.current = '';

    // Enable SGR mouse mode (unless parent manages it centrally)
    if (manageMode && process.stdout && typeof process.stdout.write === 'function') {
      process.stdout.write(ENABLE_SGR);
    }

    // Attach listener
    stdin.on('data', onData);

    return () => {
      bufferRef.current = '';
      // Disable mouse mode (unless parent manages it centrally)
      if (manageMode && process.stdout && typeof process.stdout.write === 'function') {
        process.stdout.write(DISABLE_SGR);
      }
      stdin.off('data', onData);
    };
  }, [isActive, stdin, onData, manageMode]);
}
