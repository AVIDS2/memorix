import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SESSION_DISCONNECT_GRACE_MS,
  createSessionStreamWatch,
  parseSessionDisconnectGraceMs,
} from '../../src/cli/commands/http-session-stream-watch.js';

describe('parseSessionDisconnectGraceMs', () => {
  it('defaults to two minutes', () => {
    expect(DEFAULT_SESSION_DISCONNECT_GRACE_MS).toBe(120_000);
    expect(parseSessionDisconnectGraceMs(undefined)).toBe(120_000);
    expect(parseSessionDisconnectGraceMs('  ')).toBe(120_000);
  });

  it('accepts explicit values and 0 to disable, invalid values keep the default', () => {
    expect(parseSessionDisconnectGraceMs('30000')).toBe(30_000);
    expect(parseSessionDisconnectGraceMs('0')).toBe(0);
    expect(parseSessionDisconnectGraceMs('-5')).toBe(120_000);
    expect(parseSessionDisconnectGraceMs('soon')).toBe(120_000);
    expect(parseSessionDisconnectGraceMs('2147483648')).toBe(120_000);
  });
});

describe('createSessionStreamWatch', () => {
  const GRACE = 1_000;
  let lastActivity: Map<string, number>;
  let abandoned: string[];

  function makeWatch(graceMs = GRACE) {
    return createSessionStreamWatch({
      graceMs,
      getLastActivity: (sid) => lastActivity.get(sid),
      onAbandoned: (sid) => abandoned.push(sid),
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    lastActivity = new Map([['s1', Date.now()]]);
    abandoned = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a session whose stream closed and stayed silent through the grace window', () => {
    const watch = makeWatch();
    watch.streamOpened('s1');
    vi.advanceTimersByTime(60_000);
    watch.streamClosed('s1', true);
    vi.advanceTimersByTime(GRACE - 1);
    expect(abandoned).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(abandoned).toEqual(['s1']);
    expect(watch.pendingCount()).toBe(0);
  });

  it('keeps a session whose client reconnects its stream within the grace window', () => {
    const watch = makeWatch();
    watch.streamOpened('s1');
    watch.streamClosed('s1', true);
    vi.advanceTimersByTime(GRACE / 2);
    watch.streamOpened('s1');
    vi.advanceTimersByTime(GRACE * 10);
    expect(abandoned).toEqual([]);
  });

  it('keeps a session that keeps sending requests after its stream closed', () => {
    const watch = makeWatch();
    watch.streamOpened('s1');
    watch.streamClosed('s1', true);
    vi.advanceTimersByTime(GRACE / 2);
    lastActivity.set('s1', Date.now());
    vi.advanceTimersByTime(GRACE);
    expect(abandoned).toEqual([]);
    expect(watch.pendingCount()).toBe(0);
  });

  it('ignores a refused GET (non-200) when no stream was open', () => {
    const watch = makeWatch();
    watch.streamOpened('s1');
    watch.streamClosed('s1', false);
    vi.advanceTimersByTime(GRACE * 10);
    expect(abandoned).toEqual([]);
  });

  it('does not arm while another stream of the same session is still open', () => {
    const watch = makeWatch();
    watch.streamOpened('s1');
    watch.streamOpened('s1'); // e.g. a concurrent GET refused with 409
    watch.streamClosed('s1', false);
    vi.advanceTimersByTime(GRACE * 10);
    expect(abandoned).toEqual([]);
    watch.streamClosed('s1', true);
    vi.advanceTimersByTime(GRACE);
    expect(abandoned).toEqual(['s1']);
  });

  it('expires after the real stream closes even when a refused GET finishes last', () => {
    const watch = makeWatch();
    watch.streamOpened('s1');
    watch.streamOpened('s1');
    watch.streamClosed('s1', true);
    watch.streamClosed('s1', false);
    vi.advanceTimersByTime(GRACE);
    expect(abandoned).toEqual(['s1']);
  });

  it('never reports a session that already closed', () => {
    const watch = makeWatch();
    watch.streamOpened('s1');
    watch.streamClosed('s1', true);
    lastActivity.delete('s1');
    vi.advanceTimersByTime(GRACE);
    expect(abandoned).toEqual([]);
  });

  it('forget and dispose cancel pending timers', () => {
    lastActivity.set('s2', Date.now());
    const watch = makeWatch();
    watch.streamOpened('s1');
    watch.streamOpened('s2');
    watch.streamClosed('s1', true);
    watch.streamClosed('s2', true);
    expect(watch.pendingCount()).toBe(2);
    watch.forget('s1');
    expect(watch.pendingCount()).toBe(1);
    watch.dispose();
    expect(watch.pendingCount()).toBe(0);
    vi.advanceTimersByTime(GRACE * 10);
    expect(abandoned).toEqual([]);
  });

  it('is fully disabled with a grace of 0', () => {
    const watch = makeWatch(0);
    watch.streamOpened('s1');
    watch.streamClosed('s1', true);
    expect(watch.pendingCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(abandoned).toEqual([]);
  });

  it('keeps a long request alive after its GET stream disconnected', () => {
    let busy = true;
    const watch = createSessionStreamWatch({
      graceMs: GRACE,
      getLastActivity: (sid) => lastActivity.get(sid),
      isBusy: () => busy,
      onAbandoned: (sid) => abandoned.push(sid),
    });
    watch.streamOpened('s1');
    watch.streamClosed('s1', true);
    vi.advanceTimersByTime(GRACE * 3);
    expect(abandoned).toEqual([]);
    busy = false;
    vi.advanceTimersByTime(GRACE);
    expect(abandoned).toEqual(['s1']);
  });

  it('does not re-arm a forgotten stream when its close event arrives late', () => {
    const watch = makeWatch();
    watch.streamOpened('s1');
    watch.forget('s1');
    watch.streamClosed('s1', true);
    expect(watch.pendingCount()).toBe(0);
  });
});
