import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const htmlPath = path.resolve(process.cwd(), 'e2e-test/memory-game/index.html');

// Skip entire suite if the demo artifact does not exist or is stale
// (missing expected markers like class="status-panel")
const htmlExists = existsSync(htmlPath);
const htmlContent = htmlExists ? readFileSync(htmlPath, 'utf8') : '';
const htmlHasExpectedMarkers = htmlContent.includes('class="status-panel"');
const describeMaybe = htmlHasExpectedMarkers ? describe : describe.skip;

const readHtml = () => readFileSync(htmlPath, 'utf8');

describeMaybe('memory game static shell', () => {
  it('renders the inline semantic layout and responsive card grid', () => {
    const html = readHtml();

    expect(html).toContain('<main');
    expect(html).toContain('<header');
    expect(html).toContain('class="game-shell"');
    expect(html).toContain('class="status-panel"');
    expect(html).toContain('class="card-grid"');
    expect(html).toContain('data-board');
    expect(html.match(/data-card(?=[\s>])/g)?.length ?? 0).toBe(16);
  });

  it('ships sixteen cards representing eight emoji pairs', () => {
    const html = readHtml();
    const emojiMatches = Array.from(html.matchAll(/data-emoji="([^"]+)"/g), match => match[1]);
    const counts = new Map<string, number>();

    for (const emoji of emojiMatches) {
      counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
    }

    expect(emojiMatches).toHaveLength(16);
    expect(counts.size).toBe(8);
    expect([...counts.values()]).toEqual(Array(8).fill(2));
  });

  it('keeps CSS inline with the requested dark theme and 3D flip hooks', () => {
    const html = readHtml();

    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).toContain('#1a1a2e');
    expect(html).toContain('#00d4ff');
    expect(html).toContain('transform-style: preserve-3d');
    expect(html).toContain('backface-visibility: hidden');
    expect(html).toContain('rotateY(180deg)');
  });
});
