/**
 * TeamEventBus — Phase 4b event emission layer tests.
 *
 * Covers: typed events, listener lifecycle, error isolation, once semantics.
 */

import { describe, it, expect, vi } from 'vitest';
import { TeamEventBus } from '../../src/team/event-bus.js';

describe('TeamEventBus', () => {
  it('should emit and receive typed events', () => {
    const bus = new TeamEventBus();
    const received: any[] = [];
    bus.on('task:created', (data) => received.push(data));

    bus.emit('task:created', { taskId: 't1', projectId: 'p1', description: 'test' });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ taskId: 't1', projectId: 'p1', description: 'test' });
  });

  it('should support multiple listeners on the same event', () => {
    const bus = new TeamEventBus();
    const a: string[] = [];
    const b: string[] = [];
    bus.on('task:completed', () => a.push('a'));
    bus.on('task:completed', () => b.push('b'));

    bus.emit('task:completed', { taskId: 't1', projectId: 'p1', agentId: 'a1' });

    expect(a).toEqual(['a']);
    expect(b).toEqual(['b']);
  });

  it('should silently drop events with no listeners', () => {
    const bus = new TeamEventBus();
    // No listeners — should not throw
    expect(() => {
      bus.emit('task:failed', { taskId: 't1', projectId: 'p1', agentId: 'a1' });
    }).not.toThrow();
  });

  it('should isolate listener errors from the emitter', () => {
    const bus = new TeamEventBus();
    bus.on('agent:joined', () => { throw new Error('listener boom'); });

    // emit wraps in try-catch — should not throw
    expect(() => {
      bus.emit('agent:joined', { agentId: 'a1', projectId: 'p1', agentType: 'test' });
    }).not.toThrow();
  });

  it('should support unsubscribe via returned function', () => {
    const bus = new TeamEventBus();
    const received: string[] = [];
    const unsub = bus.on('task:released', () => received.push('hit'));

    bus.emit('task:released', { taskId: 't1', projectId: 'p1', agentId: 'a1' });
    expect(received).toHaveLength(1);

    unsub();
    bus.emit('task:released', { taskId: 't2', projectId: 'p1', agentId: 'a1' });
    expect(received).toHaveLength(1); // no new hit
  });

  it('should support once semantics', () => {
    const bus = new TeamEventBus();
    const received: string[] = [];
    bus.once('task:claimed', () => received.push('once'));

    bus.emit('task:claimed', { taskId: 't1', projectId: 'p1', agentId: 'a1' });
    bus.emit('task:claimed', { taskId: 't2', projectId: 'p1', agentId: 'a1' });

    expect(received).toEqual(['once']); // only fired once
  });

  it('should report correct listener count', () => {
    const bus = new TeamEventBus();
    expect(bus.listenerCount('task:created')).toBe(0);

    const unsub = bus.on('task:created', () => {});
    expect(bus.listenerCount('task:created')).toBe(1);

    unsub();
    expect(bus.listenerCount('task:created')).toBe(0);
  });

  it('should removeAllListeners for a specific event', () => {
    const bus = new TeamEventBus();
    bus.on('task:created', () => {});
    bus.on('task:created', () => {});
    bus.on('agent:joined', () => {});

    bus.removeAllListeners('task:created');

    expect(bus.listenerCount('task:created')).toBe(0);
    expect(bus.listenerCount('agent:joined')).toBe(1);
  });

  it('should removeAllListeners for all events', () => {
    const bus = new TeamEventBus();
    bus.on('task:created', () => {});
    bus.on('agent:joined', () => {});

    bus.removeAllListeners();

    expect(bus.listenerCount('task:created')).toBe(0);
    expect(bus.listenerCount('agent:joined')).toBe(0);
  });
});
