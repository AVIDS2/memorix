import { describe, expect, it } from 'vitest';

import {
  buildSeries,
  createHistoryDocument,
  fetchStargazerTimestamps,
  renderStarHistorySvg,
} from '../../scripts/generate-star-history.mjs';

const starredAt = [
  '2026-01-03T12:00:00Z',
  '2026-01-01T10:00:00Z',
  '2026-01-03T12:00:00Z',
];

describe('star history generator', () => {
  it('preserves every stargazer event while ordering the series', () => {
    const series = buildSeries(starredAt);

    expect(series).toHaveLength(3);
    expect(series.map((point) => point.value)).toEqual([1, 2, 3]);
    expect(series[0].at.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(series.at(-1)?.at.toISOString()).toBe('2026-01-03T12:00:00.000Z');
  });

  it('generates an accessible SVG for both themes without invalid coordinates', () => {
    for (const themeName of ['light', 'dark']) {
      const svg = renderStarHistorySvg({
        repository: 'AVIDS2/memorix',
        starredAt,
        themeName,
      });

      expect(svg).toContain('<svg');
      expect(svg).toContain('AVIDS2/memorix Star History');
      expect(svg).toContain('3 stars');
      expect(svg).toContain(`star-history-fill-${themeName}`);
      expect(svg).not.toContain('NaN');
    }
  });

  it('writes deterministic history data without a credential or refresh timestamp', () => {
    expect(createHistoryDocument('AVIDS2/memorix', starredAt)).toEqual({
      schemaVersion: 1,
      repository: 'AVIDS2/memorix',
      starredAt: [
        '2026-01-01T10:00:00.000Z',
        '2026-01-03T12:00:00.000Z',
        '2026-01-03T12:00:00.000Z',
      ],
    });
  });

  it('requests timestamped stargazers from the GitHub API with the supplied short-lived token', async () => {
    const calls = [];
    const timestamps = await fetchStargazerTimestamps('AVIDS2/memorix', {
      token: 'actions-token',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), headers: init?.headers });
        return {
          ok: true,
          json: async () => [{ starred_at: '2026-01-02T00:00:00Z' }],
        };
      },
    });

    expect(timestamps).toEqual(['2026-01-02T00:00:00.000Z']);
    expect(calls).toEqual([
      {
        url: 'https://api.github.com/repos/AVIDS2/memorix/stargazers?per_page=100&page=1',
        headers: expect.objectContaining({
          Accept: 'application/vnd.github.star+json',
          Authorization: 'Bearer actions-token',
        }),
      },
    ]);
  });
});
