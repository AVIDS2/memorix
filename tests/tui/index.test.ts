import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderMock = vi.fn();
const waitUntilExitMock = vi.fn();
const writeMock = vi.fn();

vi.mock('ink', () => ({
  render: renderMock,
}));

vi.mock('../../src/cli/tui/App.js', () => ({
  WorkbenchApp: () => null,
}));

describe('startWorkbench', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitUntilExitMock.mockResolvedValue(undefined);
    renderMock.mockReturnValue({ waitUntilExit: waitUntilExitMock });
    writeMock.mockReturnValue(true);
    vi.spyOn(process.stdout, 'write').mockImplementation(writeMock as any);
  });

  it('does not enable alternate scroll mode around the TUI session', async () => {
    const { startWorkbench } = await import('../../src/cli/tui/index.ts');

    await startWorkbench();

    const writes = writeMock.mock.calls.map(([chunk]) => String(chunk));
    expect(writes[0]).toContain('\x1b[?1049h');
    expect(writes[0]).not.toContain('\x1b[?1007h');
    expect(writes[writes.length - 1]).toContain('\x1b[?1049l');
    expect(writes[writes.length - 1]).not.toContain('\x1b[?1007l');
  });
});
