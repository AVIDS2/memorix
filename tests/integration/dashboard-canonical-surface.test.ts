import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Dashboard canonical graph surface', () => {
  it('ships one graph renderer while retaining the backend compatibility route', async () => {
    const staticDir = path.join(process.cwd(), 'src', 'dashboard', 'static');
    const [app, index, style, server, packageText, lockText] = await Promise.all([
      fs.readFile(path.join(staticDir, 'app.js'), 'utf8'),
      fs.readFile(path.join(staticDir, 'index.html'), 'utf8'),
      fs.readFile(path.join(staticDir, 'style.css'), 'utf8'),
      fs.readFile(path.join(process.cwd(), 'src', 'dashboard', 'server.ts'), 'utf8'),
      fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
      fs.readFile(path.join(process.cwd(), 'package-lock.json'), 'utf8'),
    ]);
    const packageJson = JSON.parse(packageText);
    const packageLock = JSON.parse(lockText);
    const removedRootDependencies = [
      '@orama/plugin-data-persistence',
      'cytoscape',
      'cytoscape-dagre',
      'dagre',
      'diff',
      'remark',
      'remark-stringify',
      'undici',
    ];

    expect(app).toContain("api('knowledge-graph')");
    expect(app).toContain("api('codegraph')");
    expect(app).toContain('renderSemanticGraph(kg, codegraph)');
    expect(app).not.toContain("api('graph')");
    expect(app).not.toContain('function renderGraph(');
    expect(app).not.toContain('cytoscape');
    expect(app).not.toContain('dagre');

    expect(index).toContain('echarts@5.5.1');
    expect(index).not.toContain('cytoscape');
    expect(index).not.toContain('dagre');
    expect(style).not.toContain('cytoscape');
    expect(style).not.toContain('graph-detail');
    expect(style).not.toContain('graph-table');
    expect(style).toContain('.team-header-right {\n    flex-wrap: wrap;');
    expect(style).toContain('@media (max-width: 1100px) and (min-width: 769px)');
    expect(style).toContain('.codegraph-health');

    for (const dependency of removedRootDependencies) {
      expect(packageJson.dependencies?.[dependency], dependency).toBeUndefined();
      expect(packageLock.packages[''].dependencies?.[dependency], dependency).toBeUndefined();
    }

    expect(server).toContain("case '/graph'");
    expect(server).toContain("case '/codegraph'");
    expect(server).toContain("case '/knowledge-graph'");
  });
});
