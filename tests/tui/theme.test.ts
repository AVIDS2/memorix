import { describe, it, expect } from 'vitest';
import { computeLayoutWidths, getHomeSeparatorWidth, getStatusMessageRows } from '../../src/cli/tui/theme.js';

describe('tui layout helpers', () => {
  it('clamps the home separator width for very narrow content areas', () => {
    expect(getHomeSeparatorWidth(6)).toBe(0);
    expect(getHomeSeparatorWidth(8)).toBe(0);
    expect(getHomeSeparatorWidth(9)).toBe(1);
    expect(getHomeSeparatorWidth(80)).toBe(50);
  });

  it('counts explicit status message lines for layout reservation', () => {
    expect(getStatusMessageRows('Home — type a question')).toBe(1);
    expect(getStatusMessageRows('First\nSecond\nThird')).toBe(3);
  });

  it('never returns a negative content width on tiny terminals', () => {
    expect(computeLayoutWidths(3).contentWidth).toBe(0);
    expect(computeLayoutWidths(4).contentWidth).toBe(0);
  });
});
