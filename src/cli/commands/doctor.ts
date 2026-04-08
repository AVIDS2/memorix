/**
 * memorix doctor — One-stop diagnostic command
 *
 * Answers: "I stored something but the agent doesn't know" by showing
 * which layer in the chain is working and which is degraded.
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'doctor',
    description: 'Diagnose Memorix health — project identity, embedding, data, conflicts',
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Output as JSON instead of human-readable text',
      default: false,
    },
  },
  run: async ({ args }) => {
    const { existsSync, readFileSync } = await import('node:fs');
    const { join, basename } = await import('node:path');
    const { homedir } = await import('node:os');
    const { execSync } = await import('node:child_process');

    const report: Record<string, unknown> = {};
    const issues: string[] = [];
    const tips: string[] = [];

    const ok = (s: string) => `  ✓ ${s}`;
    const warn = (s: string) => `  ⚠ ${s}`;
    const fail = (s: string) => `  ✗ ${s}`;
    const info = (s: string) => `    ${s}`;

    // ── 1. Project Identity ──────────────────────────────────────
    const lines: string[] = [''];
    lines.push('┌─ Project Identity ─────────────────────────────────');

    let projectId = '';
    let projectName = '';
    let dataDir = '';
    let projectRoot = '';
    try {
      const { detectProjectWithDiagnostics } = await import('../../project/detector.js');
      const { getProjectDataDir } = await import('../../store/persistence.js');
      const result = detectProjectWithDiagnostics(process.cwd());

      if (result.project) {
        projectId = result.project.id;
        projectName = result.project.name;
        dataDir = await getProjectDataDir(projectId);

        // Resolve canonical ID
        try {
          const { initAliasRegistry, registerAlias } = await import('../../project/aliases.js');
          initAliasRegistry(dataDir);
          const canonical = await registerAlias(result.project);
          if (canonical !== projectId) {
            lines.push(ok(`Canonical ID: ${canonical} (alias: ${projectId})`));
            projectId = canonical;
          } else {
            lines.push(ok(`Project ID: ${projectId}`));
          }
        } catch {
          lines.push(ok(`Project ID: ${projectId} (alias resolution unavailable)`));
        }

        lines.push(ok(`Name: ${projectName}`));
        lines.push(ok(`Root: ${result.project.rootPath}`));
        lines.push(ok(`Git remote: ${result.project.gitRemote || '(none — local-only)'}`));
        lines.push(ok(`Data dir: ${dataDir}`));
        projectRoot = result.project.rootPath;

        // Load .env BEFORE any process.env reads or provider initialization (#46)
        try {
          const { loadDotenv } = await import('../../config/dotenv-loader.js');
          loadDotenv(projectRoot);
        } catch { /* best-effort */ }

        report.project = { id: projectId, name: projectName, root: result.project.rootPath, dataDir };
      } else {
        const reason = result.failure?.reason ?? 'unknown';
        const detail = result.failure?.detail ?? '';
        lines.push(fail(`No git project detected: [${reason}]`));
        lines.push(info(detail));
        issues.push(`Memorix requires a git repo to establish project identity. Run \`git init\` in this workspace first. (${reason})`);
        report.project = { error: reason, detail };
      }
    } catch (e) {
      lines.push(fail(`Project detection failed: ${e instanceof Error ? e.message : e}`));
      issues.push('Project detection crashed.');
    }

    // ── 2. Runtime Mode ──────────────────────────────────────────
    lines.push('');
    lines.push('┌─ Runtime Mode ─────────────────────────────────────');

    const memorixDir = join(homedir(), '.memorix');
    const bgStatePath = join(memorixDir, 'background.json');
    let bgRunning = false;
    let bgPort = 0;
    let bgPid = 0;

    try {
      if (existsSync(bgStatePath)) {
        const bgState = JSON.parse(readFileSync(bgStatePath, 'utf-8'));
        bgPid = bgState.pid;
        bgPort = bgState.port;
        // Check if PID is alive
        try { process.kill(bgPid, 0); bgRunning = true; } catch { /* dead */ }
      }
    } catch { /* no state file */ }

    if (bgRunning) {
      lines.push(ok(`Background control plane running (PID ${bgPid}, port ${bgPort})`));

      // Health check
      try {
        const http = await import('node:http');
        const healthy = await new Promise<boolean>((resolve) => {
          const req = http.request({ hostname: '127.0.0.1', port: bgPort, path: '/health', timeout: 3000 }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
          });
          req.on('error', () => resolve(false));
          req.on('timeout', () => { req.destroy(); resolve(false); });
          req.end();
        });
        if (healthy) {
          lines.push(ok('Health check: OK'));
        } else {
          lines.push(warn('Health check: FAILED (process alive but not responding)'));
          issues.push('Background process is alive but health check failed. Try "memorix background restart".');
        }
      } catch {
        lines.push(warn('Health check: could not connect'));
      }
      report.mode = { type: 'background', pid: bgPid, port: bgPort, healthy: true };
    } else {
      lines.push(info('Background control plane: not running'));
      lines.push(info('Current invocation: CLI (stdio)'));
      tips.push('Start background mode with: memorix background start');
      report.mode = { type: 'cli-stdio' };
    }

    // Check for unmanaged foreground on default port
    if (!bgRunning) {
      try {
        const http = await import('node:http');
        const portUsed = await new Promise<boolean>((resolve) => {
          const req = http.request({ hostname: '127.0.0.1', port: 3211, path: '/health', timeout: 2000 }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
          });
          req.on('error', () => resolve(false));
          req.on('timeout', () => { req.destroy(); resolve(false); });
          req.end();
        });
        if (portUsed) {
          lines.push(warn('Unmanaged foreground instance detected on port 3211'));
          issues.push('A foreground "memorix serve-http" is running but not managed by background mode.');
          (report.mode as any).unmanagedForeground = true;
        }
      } catch { /* ignore */ }
    }

    // ── 3. Embedding / Provider Status ───────────────────────────
    lines.push('');
    lines.push('┌─ Embedding / Provider ─────────────────────────────');

    try {
      const { getEmbeddingMode } = await import('../../config.js');
      const mode = getEmbeddingMode();

      if (mode === 'off') {
        lines.push(info('Mode: off (BM25 fulltext only)'));
        lines.push(info('Search: fulltext keyword matching'));
        report.embedding = { mode: 'off', status: 'disabled' };
      } else {
        lines.push(ok(`Mode: ${mode}`));

        // Try to initialize provider to check real status
        const { getEmbeddingProvider } = await import('../../embedding/provider.js');
        const provider = await getEmbeddingProvider();

        if (provider) {
          lines.push(ok(`Provider: ${provider.name} (${provider.dimensions}d)`));
          lines.push(ok('Status: ready'));
          lines.push(info('Search: hybrid (BM25 + vector)'));
          report.embedding = { mode, status: 'ready', provider: provider.name, dimensions: provider.dimensions };
        } else {
          lines.push(warn('Status: temporarily unavailable'));
          lines.push(info('Search: degraded to BM25 fulltext (no vector similarity)'));
          issues.push(`Embedding mode is "${mode}" but provider failed to initialize. Check API keys/connectivity.`);
          report.embedding = { mode, status: 'temporarily_unavailable' };
        }

        // Check cached embeddings count
        try {
          const cachePath = join(memorixDir, 'embedding-cache.json');
          if (existsSync(cachePath)) {
            const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
            const cacheCount = Object.keys(cache).length;
            lines.push(info(`Cached embeddings: ${cacheCount}`));
            (report.embedding as any).cachedEmbeddings = cacheCount;
          }
        } catch { /* no cache */ }
      }
    } catch (e) {
      lines.push(warn(`Embedding config error: ${e instanceof Error ? e.message : e}`));
      report.embedding = { status: 'error' };
    }

    // ── 4. Data Status ───────────────────────────────────────────
    lines.push('');
    lines.push('┌─ Data Status ─────────────────────────────────────');

    if (dataDir && existsSync(dataDir)) {
      // Observations
      let obsCount = 0;
      let activeCount = 0;
      let ranCount = 0;
      try {
        const obsFile = join(dataDir, 'observations.json');
        if (existsSync(obsFile)) {
          const obs = JSON.parse(readFileSync(obsFile, 'utf-8'));
          obsCount = Array.isArray(obs) ? obs.length : 0;
          activeCount = Array.isArray(obs) ? obs.filter((o: any) => (o.status ?? 'active') === 'active').length : 0;
          ranCount = Array.isArray(obs) ? obs.filter((o: any) => /^Ran:\s/i.test(o.title ?? '')).length : 0;
        }
      } catch { /* ignore */ }

      lines.push(ok(`Observations: ${obsCount} total, ${activeCount} active`));
      if (ranCount > 0) {
        const pct = Math.round(ranCount / obsCount * 100);
        lines.push(warn(`Command logs (Ran:): ${ranCount} (${pct}%) — filtered from search results`));
        if (pct > 50) {
          tips.push(`${pct}% of observations are command logs from hooks. Consider running cleanup or adjusting hook config.`);
        }
      }
      report.data = { observations: obsCount, active: activeCount, commandLogs: ranCount };

      // Sessions
      try {
        const sessFile = join(dataDir, 'sessions.json');
        if (existsSync(sessFile)) {
          const sess = JSON.parse(readFileSync(sessFile, 'utf-8'));
          const sessCount = Array.isArray(sess) ? sess.length : 0;
          const activeSess = Array.isArray(sess) ? sess.filter((s: any) => s.status === 'active').length : 0;
          lines.push(ok(`Sessions: ${sessCount} total, ${activeSess} active`));
          (report.data as any).sessions = sessCount;
        }
      } catch { /* ignore */ }

      // Mini-skills
      try {
        const skillsFile = join(dataDir, 'mini-skills.json');
        if (existsSync(skillsFile)) {
          const skills = JSON.parse(readFileSync(skillsFile, 'utf-8'));
          const skillCount = Array.isArray(skills) ? skills.length : 0;
          if (skillCount > 0) {
            lines.push(ok(`Mini-skills: ${skillCount}`));
            (report.data as any).miniSkills = skillCount;
          }
        }
      } catch { /* ignore */ }
    } else {
      lines.push(warn('No data directory found for current project'));
      if (!projectId) {
        issues.push('No project detected — data status unavailable.');
      }
    }

    // ── 5. Conflict Check ────────────────────────────────────────
    lines.push('');
    lines.push('┌─ Conflict Check ──────────────────────────────────');

    let conflictsFound = false;

    // Check for lock file (indicates another process is writing)
    if (dataDir) {
      const lockFile = join(dataDir, '.memorix.lock');
      if (existsSync(lockFile)) {
        try {
          const lockData = JSON.parse(readFileSync(lockFile, 'utf-8'));
          const lockAge = Date.now() - lockData.time;
          if (lockAge < 10000) {
            lines.push(warn(`Active file lock (PID ${lockData.pid}, age ${Math.round(lockAge / 1000)}s)`));
            conflictsFound = true;
          } else {
            lines.push(info(`Stale lock file (PID ${lockData.pid}, age ${Math.round(lockAge / 1000)}s) — will be auto-cleaned`));
          }
        } catch {
          lines.push(info('Lock file exists but unreadable'));
        }
      }
    }

    if (!conflictsFound) {
      lines.push(ok('No conflicts detected'));
    }
    report.conflicts = { found: conflictsFound };

    // ── 6. LLM Status ────────────────────────────────────────────
    lines.push('');
    lines.push('┌─ LLM Enhanced Mode ───────────────────────────────');

    try {
      const { loadDotenv } = await import('../../config.js');
      const { isLLMEnabled, getLLMConfig, initLLM } = await import('../../llm/provider.js');
      loadDotenv(projectRoot || process.cwd());
      initLLM();
      if (isLLMEnabled()) {
        const config = getLLMConfig();
        lines.push(ok(`Provider: ${config?.provider}/${config?.model}`));
        lines.push(info('Capabilities: fact extraction, auto-dedup, LLM rerank'));
        report.llm = { enabled: true, provider: config?.provider, model: config?.model };
      } else {
        lines.push(info('LLM mode: off (heuristic dedup only)'));
        tips.push('Enable LLM for better memory quality: memorix configure → LLM Enhanced Mode');
        report.llm = { enabled: false };
      }
    } catch {
      lines.push(info('LLM mode: off'));
      report.llm = { enabled: false };
    }

    // ── 7. Auto-Update Status ──────────────────────────────────
    lines.push('');
    lines.push('┌─ Auto-Update ─────────────────────────────────────');

    try {
      const { readCache, getCurrentVersion } = await import('../update-checker.js');
      const cache = await readCache();
      const curVer = getCurrentVersion();
      lines.push(info(`Current version: v${curVer}`));
      if (cache) {
        lines.push(info(`Latest known: v${cache.latestVersion}`));
        const lastCheckAgo = cache.lastCheck ? `${Math.round((Date.now() - cache.lastCheck) / 3600000)}h ago` : 'never';
        lines.push(info(`Last check: ${lastCheckAgo}`));
        if (cache.lastAutoUpdateStatus === 'success') {
          lines.push(ok(`Last auto-update: v${cache.updatedFrom} → v${cache.updatedTo} (restart to apply)`));
        } else if (cache.lastAutoUpdateStatus === 'failed') {
          lines.push(warn(`Last auto-update failed: ${cache.lastAutoUpdateError ?? 'unknown error'}`));
        }
      } else {
        lines.push(info('No update checks recorded yet'));
      }
      const autoEnabled = !['off', 'false', '0', 'notify'].includes(
        (process.env.MEMORIX_AUTO_UPDATE ?? '').toLowerCase().trim(),
      );
      lines.push(info(`Auto-update: ${autoEnabled ? 'enabled (install)' : 'disabled'}`));
      report.autoUpdate = { enabled: autoEnabled, currentVersion: curVer, cache };
    } catch {
      lines.push(info('Auto-update status unavailable'));
      report.autoUpdate = { enabled: false };
    }

    // ── Summary ──────────────────────────────────────────────────
    lines.push('');
    lines.push('┌─ Summary ─────────────────────────────────────────');

    if (issues.length === 0) {
      lines.push(ok('All systems healthy — no issues detected'));
    } else {
      lines.push(warn(`${issues.length} issue(s) found:`));
      for (const issue of issues) {
        lines.push(`  → ${issue}`);
      }
    }

    if (tips.length > 0) {
      lines.push('');
      lines.push('  Tips:');
      for (const tip of tips) {
        lines.push(`  💡 ${tip}`);
      }
    }

    lines.push('');

    // ── Output ───────────────────────────────────────────────────
    if (args.json) {
      report.issues = issues;
      report.tips = tips;
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(lines.join('\n'));
    }
  },
});
