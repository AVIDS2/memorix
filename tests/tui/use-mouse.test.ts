import { describe, expect, it } from 'vitest';
import { parseSGRBuffer, parseSGRSequence } from '../../src/cli/tui/use-mouse.js';

describe('parseSGRSequence', () => {
  it('parses multiple concatenated SGR mouse events from one buffer', () => {
    const events = parseSGRSequence('\x1b[<0;10;5M\x1b[<64;10;5M');

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      x: 9,
      y: 4,
      button: 'left',
      action: 'press',
    });
    expect(events[1]).toMatchObject({
      x: 9,
      y: 4,
      button: 'wheelUp',
      action: 'press',
    });
  });

  it('preserves an incomplete trailing SGR sequence until the next chunk arrives', () => {
    const first = parseSGRBuffer('prefix\x1b[<0;10');

    expect(first.events).toHaveLength(0);
    expect(first.remainder).toBe('\x1b[<0;10');

    const second = parseSGRBuffer(first.remainder + ';5M');

    expect(second.remainder).toBe('');
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toMatchObject({
      x: 9,
      y: 4,
      button: 'left',
      action: 'press',
    });
  });
});
