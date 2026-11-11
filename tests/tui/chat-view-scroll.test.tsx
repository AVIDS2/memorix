import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';

const { mockScrollBy } = vi.hoisted(() => ({
  mockScrollBy: vi.fn(),
}));

vi.mock('ink-scroll-view', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  return {
    ScrollView: ReactModule.forwardRef(function MockScrollView(
      props: { children?: React.ReactNode },
      ref: React.ForwardedRef<{
        scrollBy: (offset: number) => void;
        getViewportHeight: () => number;
        remeasure: () => void;
        getBottomOffset: () => number;
        scrollTo: (_offset: number) => void;
      }>,
    ) {
      ReactModule.useImperativeHandle(ref, () => ({
        scrollBy: mockScrollBy,
        getViewportHeight: () => 10,
        remeasure: () => {},
        getBottomOffset: () => 0,
        scrollTo: () => {},
      }), []);
      return <>{props.children}</>;
    }),
  };
});

import { ChatView } from '../../src/cli/tui/ChatView.js';

const tick = (ms = 120) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('ChatView keyboard scrolling', () => {
  beforeEach(() => {
    mockScrollBy.mockReset();
  });

  it('scrolls on down arrow when keyboard scrolling is enabled', async () => {
    const { stdin, unmount } = render(
      <ChatView
        project={{ id: 'test/proj', name: 'my-project', rootPath: '/tmp', gitRemote: 'origin' }}
        messages={[{ role: 'assistant', content: 'hello world' }]}
        loading={false}
        contentWidth={80}
        viewportHeight={10}
      />,
    );

    stdin.write('\u001B[B');
    await tick();

    expect(mockScrollBy).toHaveBeenCalledWith(3);
    unmount();
  });

  it('does not scroll on down arrow when keyboard scrolling is disabled', async () => {
    const extraProps = { keyboardScrollEnabled: false } as any;
    const { stdin, unmount } = render(
      <ChatView
        project={{ id: 'test/proj', name: 'my-project', rootPath: '/tmp', gitRemote: 'origin' }}
        messages={[{ role: 'assistant', content: 'hello world' }]}
        loading={false}
        contentWidth={80}
        viewportHeight={10}
        {...extraProps}
      />,
    );

    stdin.write('\u001B[B');
    await tick();

    expect(mockScrollBy).not.toHaveBeenCalled();
    unmount();
  });
});
