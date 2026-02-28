/**
 * Memorix Dashboard — SPA Application
 * Vanilla JS, zero dependencies, i18n support (EN/ZH)
 */

// ============================================================
// i18n — Internationalization
// ============================================================

const i18n = {
  en: {
    // Dashboard
    dashboard: 'Dashboard',
    dashboardSubtitle: 'Overview of your project memory',
    entities: 'Entities',
    relations: 'Relations',
    observations: 'Observations',
    nextId: 'Next ID',
    observationTypes: 'Observation Types',
    recentActivity: 'Recent Activity',
    noObservationsYet: 'No observations yet',
    noRecentActivity: 'No recent activity',
    noData: 'No Data',
    noDataDesc: 'Start using Memorix to see your dashboard',

    // Graph
    knowledgeGraph: 'Knowledge Graph',
    noGraphData: 'No Graph Data',
    noGraphDataDesc: 'Create entities and relations to see your knowledge graph',
    observation_s: 'observation(s)',
    nodes: 'nodes',
    edges: 'edges',
    clickNodeToView: 'Click a node to view details',
    legend: 'Legend',
    noObservations: 'No observations',
    noRelations: 'No relations',

    // Observations
    observationsStored: 'observations stored',
    searchObservations: 'Search observations...',
    all: 'All',
    noMatchingObs: 'No matching observations',
    noObsTitle: 'No Observations',
    noObsDesc: 'Use memorix_store to create observations',
    untitled: 'Untitled',
    exportData: 'Export',
    deleteObs: 'Delete',
    deleteConfirm: 'Delete observation #%id%?',
    batchCleanup: 'Cleanup',
    selected: 'selected',
    cancel: 'Cancel',
    deleteSelected: 'Delete Selected',
    batchDeleteConfirm: 'Delete %count% observations?',
    deleted: 'Deleted',
    narrative: 'Narrative',
    facts: 'Facts',
    concepts: 'Concepts',
    files: 'Files Modified',
    clickToExpand: 'Click to expand',
    vectorSearch: 'Vector Search',
    fulltextOnly: 'Fulltext Only',
    enabled: 'Enabled',
    typeDistribution: 'Type Distribution',

    // Sessions
    sessions: 'Sessions',
    sessionsSubtitle: 'Session lifecycle timeline',
    noSessions: 'No Sessions',
    noSessionsDesc: 'Use memorix_session_start to begin tracking sessions',
    sessionActive: 'Active',
    sessionCompleted: 'Completed',
    sessionAgent: 'Agent',
    sessionStarted: 'Started',
    sessionEnded: 'Ended',
    sessionSummary: 'Summary',

    // Retention
    memoryRetention: 'Memory Retention',
    retentionSubtitle: 'Exponential decay scoring with immunity rules',
    active: 'Active',
    stale: 'Stale',
    archiveCandidates: 'Archive Candidates',
    immune: 'Immune',
    allObsByScore: 'All Observations by Retention Score',
    id: 'ID',
    title: 'Title',
    type: 'Type',
    entity: 'Entity',
    score: 'Score',
    ageH: 'Age (h)',
    access: 'Access',
    status: 'Status',
    noRetentionData: 'No Retention Data',
    noRetentionDesc: 'Store observations to see memory retention scores',

    // Nav tooltips
    navDashboard: 'Dashboard',
    navGraph: 'Knowledge Graph',
    navObservations: 'Observations',
    navRetention: 'Retention',
    navSessions: 'Sessions',
  },
  zh: {
    // Dashboard
    dashboard: '仪表盘',
    dashboardSubtitle: '项目记忆概览',
    entities: '实体',
    relations: '关系',
    observations: '观察记录',
    nextId: '下一个 ID',
    observationTypes: '观察类型分布',
    recentActivity: '最近活动',
    noObservationsYet: '暂无观察记录',
    noRecentActivity: '暂无最近活动',
    noData: '暂无数据',
    noDataDesc: '开始使用 Memorix 来查看仪表盘',

    // Graph
    knowledgeGraph: '知识图谱',
    noGraphData: '暂无图谱数据',
    noGraphDataDesc: '创建实体和关系来查看知识图谱',
    observation_s: '条观察',
    nodes: '个节点',
    edges: '条边',
    clickNodeToView: '点击节点查看详情',
    legend: '图例',
    noObservations: '暂无观察',
    noRelations: '暂无关系',

    // Observations
    observationsStored: '条观察已存储',
    searchObservations: '搜索观察记录...',
    all: '全部',
    noMatchingObs: '没有匹配的观察记录',
    noObsTitle: '暂无观察记录',
    noObsDesc: '使用 memorix_store 创建观察记录',
    untitled: '无标题',
    exportData: '导出',
    deleteObs: '删除',
    deleteConfirm: '确认删除观察 #%id%？',
    batchCleanup: '清理',
    selected: '已选中',
    cancel: '取消',
    deleteSelected: '删除选中',
    batchDeleteConfirm: '确认删除 %count% 条观察？',
    deleted: '已删除',
    narrative: '叙述',
    facts: '事实',
    concepts: '概念',
    files: '相关文件',
    clickToExpand: '点击展开',
    vectorSearch: '向量搜索',
    fulltextOnly: '仅全文搜索',
    enabled: '已启用',
    typeDistribution: '类型分布',

    // Sessions
    sessions: '会话',
    sessionsSubtitle: '会话生命周期时间线',
    noSessions: '暂无会话',
    noSessionsDesc: '使用 memorix_session_start 开始跟踪会话',
    sessionActive: '进行中',
    sessionCompleted: '已完成',
    sessionAgent: 'Agent',
    sessionStarted: '开始时间',
    sessionEnded: '结束时间',
    sessionSummary: '摘要',

    // Retention
    memoryRetention: '记忆衰减',
    retentionSubtitle: '基于指数衰减的评分系统，支持免疫规则',
    active: '活跃',
    stale: '陈旧',
    archiveCandidates: '归档候选',
    immune: '免疫',
    allObsByScore: '按衰减分数排列的所有观察',
    id: 'ID',
    title: '标题',
    type: '类型',
    entity: '实体',
    score: '分数',
    ageH: '年龄 (h)',
    access: '访问次数',
    status: '状态',
    noRetentionData: '暂无衰减数据',
    noRetentionDesc: '存储观察记录以查看记忆衰减分数',

    // Nav tooltips
    navDashboard: '仪表盘',
    navGraph: '知识图谱',
    navObservations: '观察记录',
    navRetention: '记忆衰减',
    navSessions: '会话',
  },
};

let currentLang = localStorage.getItem('memorix-lang') || 'en';

function t(key) {
  return (i18n[currentLang] && i18n[currentLang][key]) || i18n.en[key] || key;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('memorix-lang', lang);

  // Update label text
  const label = document.getElementById('lang-label');
  if (label) label.textContent = lang === 'en' ? '中文' : 'EN';

  // Update nav tooltips
  const tooltipMap = { dashboard: 'navDashboard', graph: 'navGraph', observations: 'navObservations', retention: 'navRetention', sessions: 'navSessions' };
  document.querySelectorAll('.nav-btn').forEach(b => {
    const page = b.dataset.page;
    if (page && tooltipMap[page]) b.title = t(tooltipMap[page]);
  });

  // Force reload all pages
  Object.keys(loaded).forEach(k => delete loaded[k]);
  loadPage(currentPage);
}

// Init lang toggle button
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('lang-toggle');
  const label = document.getElementById('lang-label');
  if (label) label.textContent = currentLang === 'en' ? '中文' : 'EN';
  if (btn) {
    btn.addEventListener('click', () => {
      setLang(currentLang === 'en' ? 'zh' : 'en');
    });
  }
});

// ============================================================
// Theme Toggle (Light / Dark)
// ============================================================

let currentTheme = localStorage.getItem('memorix-theme') || 'dark';

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('memorix-theme', theme);

  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');
  const themeLabel = document.getElementById('theme-label');
  if (sunIcon && moonIcon) {
    sunIcon.style.display = theme === 'dark' ? 'none' : 'block';
    moonIcon.style.display = theme === 'dark' ? 'block' : 'none';
  }
  if (themeLabel) themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';

  // Force reload current page so Canvas graph redraws with new colors
  try {
    if (typeof currentPage !== 'undefined' && loaded[currentPage]) {
      delete loaded[currentPage];
      loadPage(currentPage);
    }
  } catch { /* initial call before loaded is defined */ }
}

// Apply saved theme immediately
applyTheme(currentTheme);

document.addEventListener('DOMContentLoaded', () => {
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  }
});

// ============================================================
// Router & Navigation
// ============================================================

const pages = ['dashboard', 'graph', 'observations', 'retention', 'sessions'];
let currentPage = 'dashboard';

function navigate(page) {
  if (!pages.includes(page)) return;
  currentPage = page;

  // Update nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  // Update pages
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === `page-${page}`);
  });

  // Load page data
  loadPage(page);
}

// Nav click handlers
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.page));
});

// ============================================================
// API Client
// ============================================================

let selectedProject = ''; // empty = current project (default)

async function api(endpoint) {
  try {
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = selectedProject
      ? `/api/${endpoint}${sep}project=${encodeURIComponent(selectedProject)}`
      : `/api/${endpoint}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`API error (${endpoint}):`, err);
    return null;
  }
}

// ============================================================
// Project Switcher — Custom Dropdown
// ============================================================

let allProjects = [];

async function initProjectSwitcher() {
  const switcher = document.getElementById('project-switcher');
  const trigger = document.getElementById('project-trigger');
  const dropdown = document.getElementById('project-dropdown');
  const nameEl = document.getElementById('project-name');
  const countEl = document.getElementById('project-count');
  const listEl = document.getElementById('project-list');
  const searchEl = document.getElementById('project-search');
  if (!trigger || !dropdown) return;

  // Check URL parameter for project override
  const urlParams = new URLSearchParams(window.location.search);
  const urlProject = urlParams.get('project');

  // Fetch project list
  try {
    const res = await fetch('/api/projects');
    allProjects = await res.json();
    if (!Array.isArray(allProjects) || allProjects.length === 0) {
      nameEl.textContent = 'No projects';
      return;
    }

    // Determine active project
    let active = allProjects.find(p => p.isCurrent);
    if (urlProject) {
      const urlMatch = allProjects.find(p => p.id === urlProject);
      if (urlMatch) {
        active = urlMatch;
        selectedProject = urlMatch.id;
        Object.keys(loaded).forEach(k => delete loaded[k]);
        loadPage(currentPage);
      }
    }
    if (!active) active = allProjects[0];

    updateTrigger(active);
    renderProjectList(allProjects, active);
  } catch {
    nameEl.textContent = 'Error';
  }

  // Toggle dropdown
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    switcher.classList.toggle('open');
    if (switcher.classList.contains('open')) {
      searchEl.value = '';
      searchEl.focus();
      renderProjectList(allProjects);
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!switcher.contains(e.target)) {
      switcher.classList.remove('open');
    }
  });

  // Search filter
  searchEl.addEventListener('input', () => {
    const q = searchEl.value.toLowerCase();
    const filtered = allProjects.filter(p =>
      p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    );
    renderProjectList(filtered);
  });

  // Keyboard: Escape closes
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') switcher.classList.remove('open');
  });

  function updateTrigger(project) {
    nameEl.textContent = project.name;
    nameEl.title = project.id;
    countEl.textContent = project.count || '';
  }

  function renderProjectList(projects, activeOverride) {
    const activeId = activeOverride ? activeOverride.id : (selectedProject || allProjects.find(p => p.isCurrent)?.id || '');
    listEl.innerHTML = projects.map(p => `
      <button class="project-item${p.id === activeId || (p.isCurrent && !activeId) ? ' active' : ''}"
              data-id="${escapeHtml(p.id)}" title="${escapeHtml(p.id)}">
        <span class="project-item-dot"></span>
        <span class="project-item-name">${escapeHtml(p.name)}</span>
        <span class="project-item-count">${p.count}</span>
      </button>
    `).join('');

    // Click handlers
    listEl.querySelectorAll('.project-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        const project = allProjects.find(p => p.id === id);
        if (!project) return;

        selectedProject = project.isCurrent ? '' : project.id;
        updateTrigger(project);
        switcher.classList.remove('open');

        // Mark active
        listEl.querySelectorAll('.project-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');

        // Reload pages
        Object.keys(loaded).forEach(k => delete loaded[k]);
        loadPage(currentPage);
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initProjectSwitcher();
});

// ============================================================
// Page Loaders
// ============================================================

const loaded = {};

async function loadPage(page) {
  if (loaded[page]) return;

  switch (page) {
    case 'dashboard': await loadDashboard(); break;
    case 'graph': await loadGraph(); break;
    case 'observations': await loadObservations(); break;
    case 'retention': await loadRetention(); break;
    case 'sessions': await loadSessions(); break;
  }
  loaded[page] = true;
}

// ============================================================
// Dashboard Page
// ============================================================

async function loadDashboard() {
  const container = document.getElementById('page-dashboard');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const [stats, project] = await Promise.all([api('stats'), api('project')]);
  if (!stats) {
    container.innerHTML = emptyState('📊', t('noData'), t('noDataDesc'));
    return;
  }

  const projectLabel = project ? project.name : '';

  const typeIcons = {
    'session-request': '🎯', gotcha: '🔴', 'problem-solution': '🟡',
    'how-it-works': '🔵', 'what-changed': '🟢', discovery: '🟣',
    'why-it-exists': '🟠', decision: '🟤', 'trade-off': '⚖️',
  };

  // Type distribution
  const typeEntries = Object.entries(stats.typeCounts || {}).sort((a, b) => b[1] - a[1]);
  const maxTypeCount = Math.max(...typeEntries.map(e => e[1]), 1);

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('dashboard')} ${projectLabel ? `<span style="font-size: 14px; font-weight: 400; color: var(--text-muted); margin-left: 8px; padding: 2px 10px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 6px; vertical-align: middle;">${escapeHtml(projectLabel)}</span>` : ''}</h1>
      <p class="page-subtitle">${t('dashboardSubtitle')}</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card" data-accent="cyan">
        <div class="stat-label">${t('entities')}</div>
        <div class="stat-value">${stats.entities}</div>
      </div>
      <div class="stat-card" data-accent="purple">
        <div class="stat-label">${t('relations')}</div>
        <div class="stat-value">${stats.relations}</div>
      </div>
      <div class="stat-card" data-accent="amber">
        <div class="stat-label">${t('observations')}</div>
        <div class="stat-value">${stats.observations}</div>
      </div>
      <div class="stat-card" data-accent="green">
        <div class="stat-label">${t('nextId')}</div>
        <div class="stat-value">#${stats.nextId}</div>
      </div>
      <div class="stat-card" data-accent="${stats.embedding?.enabled ? 'cyan' : 'amber'}">
        <div class="stat-label">${t('vectorSearch')}</div>
        <div class="stat-value" style="font-size: 18px;">${stats.embedding?.enabled ? '✓ ' + t('enabled') : t('fulltextOnly')}</div>
        ${stats.embedding?.provider ? `<div style="font-size: 10px; color: var(--text-muted); margin-top: 4px; font-family: var(--font-mono);">${stats.embedding.provider} (${stats.embedding.dimensions}d)</div>` : ''}
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">${t('observationTypes')}</span>
        </div>
        <div class="panel-body">
          ${typeEntries.length > 0 ? `
            <div style="display: flex; gap: 20px; align-items: flex-start;">
              <canvas id="type-pie-chart" width="140" height="140" style="flex-shrink: 0;"></canvas>
              <div style="flex: 1;">
                ${typeEntries.map(([type, count]) => `
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <span style="width: 18px; text-align: center; font-size: 13px;">${typeIcons[type] || '❓'}</span>
                    <span style="width: 110px; font-size: 11px; color: var(--text-secondary);">${type}</span>
                    <div style="flex: 1; height: 5px; background: rgba(128,128,128,0.1); border-radius: 3px; overflow: hidden;">
                      <div style="width: ${(count / maxTypeCount) * 100}%; height: 100%; background: var(--type-${type}, var(--accent-cyan)); border-radius: 3px;"></div>
                    </div>
                    <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); min-width: 22px; text-align: right;">${count}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : `<p style="color: var(--text-muted); font-size: 13px;">${t('noObservationsYet')}</p>`}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">${t('recentActivity')}</span>
        </div>
        <div class="panel-body">
          <ul class="activity-list">
            ${(stats.recentObservations || []).map(obs => `
              <li class="activity-item">
                <span class="activity-id">#${obs.id}</span>
                <span class="type-badge" data-type="${obs.type}">
                  <span class="type-icon" data-type="${obs.type}"></span>
                  ${obs.type}
                </span>
                <span class="activity-title">${escapeHtml(obs.title || t('untitled'))}</span>
                <span class="activity-entity">${escapeHtml(obs.entityName || '')}</span>
              </li>
            `).join('')}
          </ul>
          ${(stats.recentObservations || []).length === 0 ? `<p style="color: var(--text-muted); font-size: 13px; padding: 12px 0;">${t('noRecentActivity')}</p>` : ''}
        </div>
      </div>
    </div>
  `;

  // Render pie chart if data exists
  if (typeEntries.length > 0) {
    requestAnimationFrame(() => renderPieChart('type-pie-chart', typeEntries, typeIcons));
  }
}

/** Draw a mini donut chart on a canvas */
function renderPieChart(canvasId, entries, icons) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 140;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2, r = 54, inner = 34;
  const total = entries.reduce((s, e) => s + e[1], 0);
  const colors = [
    '#06b6d4', '#a855f7', '#f59e0b', '#22c55e',
    '#3b82f6', '#ef4444', '#ec4899', '#f97316', '#6366f1',
  ];

  let angle = -Math.PI / 2;
  entries.forEach(([type, count], i) => {
    const slice = (count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + inner * Math.cos(angle), cy + inner * Math.sin(angle));
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.arc(cx, cy, inner, angle + slice, angle, true);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    angle += slice;
  });

  // Center text
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#fff';
  ctx.font = 'bold 20px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total, cx, cy - 6);
  ctx.font = '10px system-ui';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#888';
  ctx.fillText('total', cx, cy + 10);
}

// ============================================================
// Knowledge Graph Page
// ============================================================

async function loadGraph() {
  const container = document.getElementById('page-graph');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const graph = await api('graph');
  if (!graph || (graph.entities.length === 0 && graph.relations.length === 0)) {
    container.innerHTML = emptyState('🕸️', t('noGraphData'), t('noGraphDataDesc'));
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('knowledgeGraph')}</h1>
      <p class="page-subtitle">${graph.entities.length} ${t('entities').toLowerCase()}, ${graph.relations.length} ${t('relations').toLowerCase()}</p>
    </div>
    <div class="graph-layout">
      <div id="graph-container">
        <canvas id="graph-canvas"></canvas>
        <div class="graph-tooltip" id="graph-tooltip">
          <div class="graph-tooltip-name"></div>
          <div class="graph-tooltip-type"></div>
        </div>
      </div>
      <div id="graph-detail" class="graph-detail">
        <div class="graph-detail-empty">${t('clickNodeToView') || 'Click a node to view details'}</div>
      </div>
    </div>
  `;

  renderGraph(graph);
}

// ============================================================
// Canvas-based Force-Directed Graph — InfraNodus Style
// Solid glowing nodes, colored gradient edges, labels on nodes
// ============================================================

function renderGraph(graph) {
  const canvas = document.getElementById('graph-canvas');
  const ctx = canvas.getContext('2d');
  const container = document.getElementById('graph-container');

  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;

  // --- InfraNodus-inspired vibrant palette ---
  const palette = [
    '#22c55e', '#f97316', '#a855f7', '#06b6d4',
    '#eab308', '#ec4899', '#3b82f6', '#ef4444',
  ];
  const typeColors = {};
  let colorIdx = 0;
  function getTypeColor(type) {
    if (!typeColors[type]) { typeColors[type] = palette[colorIdx % palette.length]; colorIdx++; }
    return typeColors[type];
  }

  // Detect if one type dominates — if so, use name-hash for color variety
  const typeCounts = {};
  graph.entities.forEach(e => { typeCounts[e.entityType] = (typeCounts[e.entityType] || 0) + 1; });
  const maxTypeCount = Math.max(...Object.values(typeCounts));
  const useNameHash = maxTypeCount > graph.entities.length * 0.6;

  function hashColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
    return palette[((h % palette.length) + palette.length) % palette.length];
  }

  // --- Build nodes & edges ---
  const nodes = graph.entities.map((e) => {
    const obsCount = e.observations.length;
    return {
      id: e.name, type: e.entityType, observations: e.observations,
      x: (Math.random() - 0.5) * W * 0.5,
      y: (Math.random() - 0.5) * H * 0.5,
      vx: 0, vy: 0,
      baseRadius: Math.max(5, Math.min(4 + Math.sqrt(obsCount) * 3, 20)),
      radius: 0,
      color: useNameHash ? hashColor(e.name) : getTypeColor(e.entityType),
      degree: 0,
    };
  });
  const nodeMap = {};
  nodes.forEach(n => nodeMap[n.id] = n);

  const edges = graph.relations
    .filter(r => nodeMap[r.from] && nodeMap[r.to])
    .map(r => {
      nodeMap[r.from].degree++;
      nodeMap[r.to].degree++;
      return { source: nodeMap[r.from], target: nodeMap[r.to], type: r.relationType };
    });

  // Ensure typeColors populated for legend
  Object.keys(typeCounts).forEach(t => getTypeColor(t));

  // Node sizing: smaller circles (labels are the visual identity in InfraNodus)
  const maxDegree = Math.max(1, ...nodes.map(n => n.degree));
  nodes.forEach(n => {
    const degreeBoost = (n.degree / maxDegree) * 12;
    n.radius = Math.min(n.baseRadius * 0.7 + degreeBoost, 24);
  });

  // --- Camera (zoom & pan) ---
  let cam = { x: 0, y: 0, zoom: 1 };
  function worldToScreen(wx, wy) {
    return { x: (wx - cam.x) * cam.zoom + W / 2, y: (wy - cam.y) * cam.zoom + H / 2 };
  }
  function screenToWorld(sx, sy) {
    return { x: (sx - W / 2) / cam.zoom + cam.x, y: (sy - H / 2) / cam.zoom + cam.y };
  }

  // --- Physics (organic layout, not circular) ---
  const REPULSION = 3000;
  const ATTRACTION = 0.008;
  const DAMPING = 0.82;
  const IDEAL_DIST = 70;

  let animating = true;
  let hoveredNode = null;
  let selectedNode = null;
  let dragNode = null;
  let panStart = null;
  let simTick = 0;

  // Group nodes by color for clustered initial placement
  const colorGroups = {};
  nodes.forEach(n => { (colorGroups[n.color] = colorGroups[n.color] || []).push(n); });
  const groupKeys = Object.keys(colorGroups);
  groupKeys.forEach((color, gi) => {
    const angle = (gi / groupKeys.length) * Math.PI * 2;
    const groupR = Math.min(W, H) * 0.15;
    const cx = Math.cos(angle) * groupR;
    const cy = Math.sin(angle) * groupR;
    colorGroups[color].forEach(n => {
      n.x = cx + (Math.random() - 0.5) * groupR * 0.8;
      n.y = cy + (Math.random() - 0.5) * groupR * 0.8;
    });
  });

  function simulate() {
    simTick++;
    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let force = REPULSION / (dist * dist);
        // Same-color nodes repel less (stay closer → clusters)
        if (a.color === b.color) force *= 0.5;
        let fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
    // Attraction (edges)
    for (const edge of edges) {
      let dx = edge.target.x - edge.source.x, dy = edge.target.y - edge.source.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      let force = (dist - IDEAL_DIST) * ATTRACTION;
      let fx = (dx / dist) * force, fy = (dy / dist) * force;
      edge.source.vx += fx; edge.source.vy += fy;
      edge.target.vx -= fx; edge.target.vy -= fy;
    }
    // Weak center gravity (connected nodes stronger, isolated weaker)
    for (const node of nodes) {
      const grav = node.degree > 0 ? 0.006 : 0.002;
      node.vx += (0 - node.x) * grav;
      node.vy += (0 - node.y) * grav;
    }
    // Random jitter in early frames to break symmetry
    const jitter = simTick < 100 ? 0.3 : 0;
    let totalMovement = 0;
    for (const node of nodes) {
      if (node === dragNode) continue;
      node.vx *= DAMPING; node.vy *= DAMPING;
      if (jitter > 0) {
        node.vx += (Math.random() - 0.5) * jitter;
        node.vy += (Math.random() - 0.5) * jitter;
      }
      node.x += node.vx; node.y += node.vy;
      totalMovement += Math.abs(node.vx) + Math.abs(node.vy);
    }
    return totalMovement;
  }

  function isLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }

  function hexRGBA(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // --- Draw (InfraNodus style) ---
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const light = isLight();

    // --- Edges: ALL colored with gradient (InfraNodus signature) ---
    for (const edge of edges) {
      const isActive = (hoveredNode && (edge.source === hoveredNode || edge.target === hoveredNode))
        || (selectedNode && (edge.source === selectedNode || edge.target === selectedNode));
      const s = worldToScreen(edge.source.x, edge.source.y);
      const t2 = worldToScreen(edge.target.x, edge.target.y);
      const mx = (s.x + t2.x) / 2, my = (s.y + t2.y) / 2;
      const dx = t2.x - s.x, dy = t2.y - s.y;
      const edgeLen = Math.sqrt(dx * dx + dy * dy);
      const ox = -dy * 0.05, oy = dx * 0.05;

      if (edge.source._dimmed || edge.target._dimmed) { ctx.globalAlpha = 0.03; }

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(mx + ox, my + oy, t2.x, t2.y);

      // Fix: avoid degenerate gradient when endpoints overlap
      let edgeStyle;
      if (edgeLen < 2) {
        edgeStyle = hexRGBA(edge.source.color, isActive ? 0.8 : 0.3);
      } else {
        const grad = ctx.createLinearGradient(s.x, s.y, t2.x, t2.y);
        if (isActive) {
          grad.addColorStop(0, hexRGBA(edge.source.color, 0.8));
          grad.addColorStop(1, hexRGBA(edge.target.color, 0.8));
        } else {
          grad.addColorStop(0, hexRGBA(edge.source.color, light ? 0.2 : 0.35));
          grad.addColorStop(1, hexRGBA(edge.target.color, light ? 0.2 : 0.35));
        }
        edgeStyle = grad;
      }
      ctx.strokeStyle = edgeStyle;
      ctx.lineWidth = isActive ? 2.5 * cam.zoom : Math.max(0.8, 1.2 * cam.zoom);
      ctx.stroke();

      // Active edge: label
      if (isActive) {
        ctx.font = `500 ${Math.max(9, 10 * cam.zoom)}px Inter, sans-serif`;
        ctx.fillStyle = light ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)';
        ctx.textAlign = 'center';
        ctx.fillText(edge.type, mx + ox, my + oy - 6 * cam.zoom);
      }
      ctx.globalAlpha = 1;
    }

    // --- Nodes: solid filled with subtle glow (InfraNodus style) ---
    for (const node of nodes) {
      const active = node === hoveredNode || node === selectedNode;
      const p = worldToScreen(node.x, node.y);
      const r = node.radius * cam.zoom;

      if (p.x + r * 4 < 0 || p.x - r * 4 > W || p.y + r * 4 < 0 || p.y - r * 4 > H) continue;
      if (node._dimmed) { ctx.globalAlpha = 0.08; }

      // --- Subtle outer glow (reduced in light mode) ---
      const glowAlpha = light ? (active ? 0.15 : 0.06) : (active ? 0.35 : 0.12);
      const glowR = r * (active ? 3.5 : 2.2);
      const glow = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, glowR);
      glow.addColorStop(0, hexRGBA(node.color, glowAlpha));
      glow.addColorStop(1, hexRGBA(node.color, 0));
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      // --- Solid filled node ---
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();

      // Specular highlight
      if (r > 4) {
        const spec = ctx.createRadialGradient(
          p.x - r * 0.3, p.y - r * 0.3, 0,
          p.x, p.y, r * 0.9
        );
        spec.addColorStop(0, 'rgba(255,255,255,0.3)');
        spec.addColorStop(0.5, 'rgba(255,255,255,0.05)');
        spec.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = spec;
        ctx.fill();
      }

      // --- Labels: InfraNodus style — NODE COLOR text, size ~ importance ---
      const isImportant = node.degree >= maxDegree * 0.2 || node.radius >= 14;
      const showLabel = active || isImportant || cam.zoom > 0.6;

      if (showLabel) {
        // InfraNodus: important labels are HUGE (up to 28px), small ones ~9px
        const baseFontSize = active ? 18 : (isImportant ? Math.min(12 + node.radius * 0.6, 28) : 9);
        const fontSize = Math.max(7, baseFontSize * cam.zoom);
        ctx.font = `${active || isImportant ? '700' : '400'} ${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const labelText = node.id.length > 24 && !active ? node.id.slice(0, 22) + '…' : node.id;

        // Text shadow for readability
        ctx.strokeStyle = light ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)';
        ctx.lineWidth = light ? 3 : 2.5;
        ctx.lineJoin = 'round';
        ctx.strokeText(labelText, p.x, p.y);

        // Main text in NODE COLOR (InfraNodus signature)
        ctx.fillStyle = active ? (light ? '#000' : '#fff') : node.color;
        ctx.fillText(labelText, p.x, p.y);
        ctx.textBaseline = 'alphabetic';
      }

      ctx.globalAlpha = 1;
    }

    // --- Zoom indicator ---
    const zoomPct = Math.round(cam.zoom * 100);
    if (zoomPct !== 100) {
      ctx.font = '500 11px Inter, sans-serif';
      ctx.fillStyle = light ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.25)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${zoomPct}%`, 12, H - 12);
    }

    if ((selectedNode || hoveredNode) && !animating) requestAnimationFrame(draw);
  }

  // --- Legend ---
  function buildLegend() {
    let existing = container.querySelector('.graph-legend');
    if (existing) existing.remove();

    const legend = document.createElement('div');
    legend.className = 'graph-legend';
    legend.style.cssText = `
      position: absolute; top: 12px; right: 12px; z-index: 10;
      background: var(--bg-card);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-medium);
      border-radius: 12px; padding: 12px 14px; min-width: 140px;
      font-family: 'Inter', sans-serif; font-size: 11px;
      color: var(--text-secondary);
      box-shadow: 0 4px 24px rgba(0,0,0,0.12);
    `;

    const typeCount = {};
    nodes.forEach(n => { typeCount[n.type] = (typeCount[n.type] || 0) + 1; });

    const title = document.createElement('div');
    title.style.cssText = 'font-weight: 600; font-size: 10px; margin-bottom: 8px; color: var(--text-muted); letter-spacing: 0.8px; text-transform: uppercase;';
    title.textContent = t('legend') || 'Legend';
    legend.appendChild(title);

    Object.entries(typeCount)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; cursor: pointer; transition: background 0.15s;';

        const dot = document.createElement('span');
        dot.style.cssText = `width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: ${typeColors[type] || '#666'}; box-shadow: 0 0 8px ${typeColors[type] || '#666'}40;`;

        const label = document.createElement('span');
        label.style.cssText = 'flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px;';
        label.textContent = type;

        const badge = document.createElement('span');
        badge.style.cssText = 'font-size: 10px; opacity: 0.5; font-family: var(--font-mono);';
        badge.textContent = count;

        row.appendChild(dot);
        row.appendChild(label);
        row.appendChild(badge);

        row.addEventListener('mouseenter', () => {
          row.style.background = 'var(--bg-card-hover)';
          nodes.forEach(n => { n._dimmed = n.type !== type; });
          edges.forEach(e => {}); // edges handled via source/target._dimmed
          draw();
        });
        row.addEventListener('mouseleave', () => {
          row.style.background = '';
          nodes.forEach(n => { n._dimmed = false; });
          draw();
        });

        legend.appendChild(row);
      });

    const stats = document.createElement('div');
    stats.style.cssText = 'margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-subtle); font-size: 10px; opacity: 0.4; font-family: var(--font-mono);';
    stats.textContent = `${nodes.length} nodes · ${edges.length} edges`;
    legend.appendChild(stats);

    // Zoom controls
    const controls = document.createElement('div');
    controls.style.cssText = 'display: flex; gap: 4px; margin-top: 8px;';
    const zoomIn = document.createElement('button');
    zoomIn.textContent = '+';
    zoomIn.style.cssText = 'flex:1; padding: 4px; border: 1px solid var(--border-subtle); background: transparent; color: var(--text-secondary); border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 600;';
    zoomIn.onclick = () => { cam.zoom = Math.min(cam.zoom * 1.3, 4); draw(); };
    const zoomOut = document.createElement('button');
    zoomOut.textContent = '−';
    zoomOut.style.cssText = zoomIn.style.cssText;
    zoomOut.onclick = () => { cam.zoom = Math.max(cam.zoom / 1.3, 0.2); draw(); };
    const zoomReset = document.createElement('button');
    zoomReset.textContent = '⟳';
    zoomReset.style.cssText = zoomIn.style.cssText;
    zoomReset.onclick = () => { cam = { x: 0, y: 0, zoom: 1 }; draw(); };
    controls.appendChild(zoomOut);
    controls.appendChild(zoomReset);
    controls.appendChild(zoomIn);
    legend.appendChild(controls);

    container.style.position = 'relative';
    container.appendChild(legend);
  }
  buildLegend();

  function showDetail(node) {
    const panel = document.getElementById('graph-detail');
    if (!node) {
      panel.innerHTML = `<div class="graph-detail-empty">${t('clickNodeToView') || 'Click a node to view details'}</div>`;
      return;
    }
    const related = edges.filter(e => e.source === node || e.target === node);
    const obsHtml = node.observations.length > 0
      ? node.observations.map(o => `<div class="graph-obs-item">${escapeHtml(o)}</div>`).join('')
      : `<div class="graph-detail-muted">${t('noObservations') || 'No observations'}</div>`;
    const relHtml = related.length > 0
      ? related.map(e => {
        const dir = e.source === node;
        const other = dir ? e.target : e.source;
        return `<div class="graph-rel-item"><span class="graph-rel-arrow">${dir ? '→' : '←'}</span> <span class="graph-rel-type">${escapeHtml(e.type)}</span> <strong>${escapeHtml(other.id)}</strong></div>`;
      }).join('')
      : `<div class="graph-detail-muted">${t('noRelations') || 'No relations'}</div>`;

    panel.innerHTML = `
      <div class="graph-detail-header">
        <div class="graph-detail-dot" style="background:${node.color};box-shadow:0 0 10px ${hexRGBA(node.color, 0.5)}"></div>
        <div>
          <div class="graph-detail-name">${escapeHtml(node.id)}</div>
          <div class="graph-detail-type">${escapeHtml(node.type)}</div>
        </div>
      </div>
      <div class="graph-detail-section">
        <h3>${t('observations')} <span class="graph-detail-count">${node.observations.length}</span></h3>
        ${obsHtml}
      </div>
      <div class="graph-detail-section">
        <h3>${t('relations')} <span class="graph-detail-count">${related.length}</span></h3>
        ${relHtml}
      </div>
    `;
  }

  // --- Animation loop ---
  function tick() {
    const movement = simulate();
    draw();
    if (movement > 0.1) {
      requestAnimationFrame(tick);
    } else {
      animating = false;
    }
  }

  function wakeUp() {
    if (!animating) {
      animating = true;
      // Give nodes a tiny nudge so simulation doesn't immediately stop
      nodes.forEach(n => {
        n.vx += (Math.random() - 0.5) * 0.5;
        n.vy += (Math.random() - 0.5) * 0.5;
      });
      tick();
    }
  }

  // --- Mouse interaction ---
  function getMouseWorld(e) {
    const r = canvas.getBoundingClientRect();
    return screenToWorld(e.clientX - r.left, e.clientY - r.top);
  }

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;

    // Panning
    if (panStart) {
      cam.x -= (e.movementX) / cam.zoom;
      cam.y -= (e.movementY) / cam.zoom;
      draw();
      return;
    }

    // Dragging node
    if (dragNode) {
      const w = screenToWorld(sx, sy);
      dragNode.x = w.x; dragNode.y = w.y;
      dragNode.vx = 0; dragNode.vy = 0;
      draw();
      return;
    }

    // Hit test
    const w = screenToWorld(sx, sy);
    let found = null;
    for (const node of nodes) {
      const dx = w.x - node.x, dy = w.y - node.y;
      if (dx * dx + dy * dy < (node.radius + 4) * (node.radius + 4)) { found = node; break; }
    }
    if (found !== hoveredNode) {
      hoveredNode = found;
      canvas.style.cursor = found ? 'pointer' : 'grab';
      if (found) {
        const tt = document.getElementById('graph-tooltip');
        tt.querySelector('.graph-tooltip-name').textContent = found.id;
        tt.querySelector('.graph-tooltip-type').textContent = `${found.type} · ${found.observations.length} ${t('observation_s')}`;
        tt.style.left = (sx + 16) + 'px';
        tt.style.top = (sy - 20) + 'px';
        tt.classList.add('visible');
      } else {
        document.getElementById('graph-tooltip').classList.remove('visible');
      }
      draw();
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (hoveredNode) {
      dragNode = hoveredNode;
      canvas.style.cursor = 'grabbing';
    } else {
      panStart = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
    }
  });

  canvas.addEventListener('mouseup', () => {
    if (dragNode) { dragNode = null; canvas.style.cursor = hoveredNode ? 'pointer' : 'grab'; wakeUp(); }
    if (panStart) { panStart = null; canvas.style.cursor = hoveredNode ? 'pointer' : 'grab'; }
  });

  canvas.addEventListener('click', () => {
    if (hoveredNode) { selectedNode = hoveredNode; showDetail(selectedNode); wakeUp(); }
  });

  canvas.addEventListener('mouseleave', () => {
    hoveredNode = null; dragNode = null; panStart = null;
    document.getElementById('graph-tooltip').classList.remove('visible');
    draw();
  });

  // Zoom with mouse wheel
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.15, Math.min(cam.zoom * factor, 5));
    // Zoom toward mouse position
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const wx = (mx - W / 2) / cam.zoom + cam.x;
    const wy = (my - H / 2) / cam.zoom + cam.y;
    cam.zoom = newZoom;
    cam.x = wx - (mx - W / 2) / cam.zoom;
    cam.y = wy - (my - H / 2) / cam.zoom;
    draw();
  }, { passive: false });

  // Start with a slight zoom-out for large graphs
  if (nodes.length > 60) cam.zoom = 0.55;
  else if (nodes.length > 30) cam.zoom = 0.7;

  canvas.style.cursor = 'grab';
  tick();
  setTimeout(() => { animating = false; }, 6000);
}

// ============================================================
// Observations Page
// ============================================================

let allObservations = [];
let obsFilter = '';
let obsTypeFilter = '';
let batchMode = false;
let selectedIds = new Set();

// Low quality detection (same patterns as CLI cleanup)
const LOW_QUALITY_OBS_PATTERNS = [
  /^Session activity/i,
  /^Updated \S+\.\w+$/i,
  /^Created \S+\.\w+$/i,
  /^Deleted \S+\.\w+$/i,
  /^Modified \S+\.\w+$/i,
  /^Ran command:/i,
  /^Read file:/i,
];
function isLowQualityObs(title) {
  return LOW_QUALITY_OBS_PATTERNS.some(p => p.test(title.trim()));
}

function renderBatchToolbar() {
  const slot = document.getElementById('batch-toolbar-slot');
  if (!slot) return;
  if (!batchMode || selectedIds.size === 0) {
    slot.innerHTML = '';
    return;
  }
  slot.innerHTML = `
    <div class="batch-toolbar">
      <span class="batch-count">${selectedIds.size} ${t('selected') || 'selected'}</span>
      <button class="batch-cancel-btn" onclick="exitBatchMode()">${t('cancel') || 'Cancel'}</button>
      <button class="batch-delete-btn" onclick="batchDeleteSelected()">🗑️ ${t('deleteSelected') || 'Delete Selected'}</button>
    </div>
  `;
}

async function batchDeleteSelected() {
  if (selectedIds.size === 0) return;
  const msg = (t('batchDeleteConfirm') || 'Delete %count% observations?').replace('%count%', selectedIds.size);
  if (!confirm(msg)) return;

  const sep = selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : '';
  let deleted = 0;
  for (const id of selectedIds) {
    try {
      const res = await fetch(`/api/observations/${id}${sep}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) deleted++;
    } catch { /* ignore individual failures */ }
  }

  allObservations = allObservations.filter(o => !selectedIds.has(o.id));
  selectedIds.clear();
  batchMode = false;
  renderObsList();
  renderBatchToolbar();

  // Update counter
  const subtitle = document.querySelector('#page-observations .page-subtitle');
  if (subtitle) subtitle.textContent = `${allObservations.length} ${t('observationsStored')}`;
}

function exitBatchMode() {
  batchMode = false;
  selectedIds.clear();
  renderObsList();
  renderBatchToolbar();
}

function toggleObsSelect(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }
  renderBatchToolbar();
  renderObsList();
}

// Make batch functions globally accessible
window.exitBatchMode = exitBatchMode;
window.batchDeleteSelected = batchDeleteSelected;
window.toggleObsSelect = toggleObsSelect;

async function loadObservations() {
  const container = document.getElementById('page-observations');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  allObservations = await api('observations') || [];

  if (allObservations.length === 0) {
    container.innerHTML = emptyState('🔍', t('noObsTitle'), t('noObsDesc'));
    return;
  }

  allObservations.sort((a, b) => (b.id || 0) - (a.id || 0));

  const types = [...new Set(allObservations.map(o => o.type).filter(Boolean))];

  container.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <h1 class="page-title">${t('observations')}</h1>
        <p class="page-subtitle">${allObservations.length} ${t('observationsStored')}</p>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="export-btn" id="btn-batch-cleanup" title="${t('batchCleanup') || 'Batch Cleanup'}">
          🧹 ${t('batchCleanup') || 'Cleanup'}
        </button>
        <button class="export-btn" id="btn-export" title="${t('exportData')}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M4 7l4 4 4-4M2 12v2h12v-2"/></svg>
          ${t('exportData')}
        </button>
      </div>
    </div>

    <div id="batch-toolbar-slot"></div>

    <div class="search-bar">
      <input class="search-input" id="obs-search" type="text" placeholder="${t('searchObservations')}" />
      <button class="filter-btn active" data-type="" id="filter-all">${t('all')}</button>
      ${types.map(tp => `<button class="filter-btn" data-type="${tp}">${tp}</button>`).join('')}
    </div>

    <div class="obs-grid" id="obs-list"></div>
  `;

  // Export handler
  document.getElementById('btn-export').addEventListener('click', () => {
    const sep = selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : '';
    window.open(`/api/export${sep}`, '_blank');
  });

  // Batch cleanup: enter batch mode, auto-select low-quality observations
  document.getElementById('btn-batch-cleanup').addEventListener('click', () => {
    batchMode = !batchMode;
    if (batchMode) {
      // Auto-select low quality ones
      selectedIds.clear();
      allObservations.forEach(obs => {
        if (isLowQualityObs(obs.title || '')) selectedIds.add(obs.id);
      });
    } else {
      selectedIds.clear();
    }
    renderObsList();
    renderBatchToolbar();
  });

  document.getElementById('obs-search').addEventListener('input', (e) => {
    obsFilter = e.target.value.toLowerCase();
    renderObsList();
  });

  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      obsTypeFilter = btn.dataset.type;
      renderObsList();
    });
  });

  renderObsList();
}

function renderObsList() {
  const list = document.getElementById('obs-list');
  if (!list) return;

  const typeIcons = {
    'session-request': '🎯', gotcha: '🔴', 'problem-solution': '🟡',
    'how-it-works': '🔵', 'what-changed': '🟢', discovery: '🟣',
    'why-it-exists': '🟠', decision: '🟤', 'trade-off': '⚖️',
  };

  let filtered = allObservations;

  if (obsTypeFilter) {
    filtered = filtered.filter(o => o.type === obsTypeFilter);
  }

  if (obsFilter) {
    filtered = filtered.filter(o =>
      (o.title || '').toLowerCase().includes(obsFilter) ||
      (o.narrative || '').toLowerCase().includes(obsFilter) ||
      (o.entityName || '').toLowerCase().includes(obsFilter) ||
      (o.facts || []).some(f => f.toLowerCase().includes(obsFilter))
    );
  }

  if (filtered.length === 0) {
    list.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-muted);">${t('noMatchingObs')}</div>`;
    return;
  }

  list.innerHTML = filtered.map(obs => {
    const isLow = isLowQualityObs(obs.title || '');
    const isSelected = selectedIds.has(obs.id);
    const hl = (text) => obsFilter ? escapeHtml(text).replace(new RegExp(`(${escapeHtml(obsFilter).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>') : escapeHtml(text);
    return `
    <div class="obs-card${isLow ? ' low-quality' : ''}" data-obs-id="${obs.id}" onclick="toggleObsDetail(${obs.id})" style="cursor:pointer;">
      <div class="obs-card-header">
        ${batchMode ? `<input type="checkbox" class="obs-checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleObsSelect(${obs.id});" />` : ''}
        <span class="obs-card-id">#${obs.id}</span>
        <span class="type-badge" data-type="${obs.type || 'unknown'}">
          ${typeIcons[obs.type] || '❓'} ${obs.type || 'unknown'}
        </span>
        ${isLow ? '<span class="low-quality-badge">low quality</span>' : ''}
        <span class="obs-card-title">${hl(obs.title || t('untitled'))}</span>
        <span class="obs-expand-icon">▼</span>
      </div>
      <div class="obs-card-meta">
        <span>📁 ${hl(obs.entityName || 'unknown')}</span>
        ${obs.createdAt ? `<span>🕐 ${formatTime(obs.createdAt)}</span>` : ''}
        ${obs.accessCount ? `<span>👁 ${obs.accessCount}</span>` : ''}
      </div>
      <div class="obs-detail" id="obs-detail-${obs.id}" style="display:none;">
       <div class="obs-detail-inner">
        ${obs.narrative ? `<div class="obs-detail-section"><label>${t('narrative')}</label><div class="obs-card-narrative">${hl(obs.narrative)}</div></div>` : ''}
        ${obs.facts && obs.facts.length > 0 ? `<div class="obs-detail-section"><label>${t('facts')}</label><div class="obs-card-facts">${obs.facts.map(f => `<span class="fact-tag">${hl(f)}</span>`).join('')}</div></div>` : ''}
        ${obs.concepts && obs.concepts.length > 0 ? `<div class="obs-detail-section"><label>${t('concepts')}</label><div class="obs-card-facts">${obs.concepts.map(c => `<span class="fact-tag concept-tag">${hl(c)}</span>`).join('')}</div></div>` : ''}
        ${obs.filesModified && obs.filesModified.length > 0 ? `<div class="obs-detail-section"><label>${t('files')}</label><div class="obs-card-facts">${obs.filesModified.map(f => `<span class="fact-tag file-tag">${hl(f)}</span>`).join('')}</div></div>` : ''}
        <div class="obs-detail-actions">
          <button class="delete-btn" onclick="deleteObs(${obs.id}, event)">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"/></svg>
            ${t('deleteObs')}
          </button>
        </div>
       </div>
      </div>
    </div>
  `;
  }).join('');
}

// ============================================================
// Retention Page
// ============================================================

async function loadRetention() {
  const container = document.getElementById('page-retention');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const data = await api('retention');
  if (!data || data.items.length === 0) {
    container.innerHTML = emptyState('📉', t('noRetentionData'), t('noRetentionDesc'));
    return;
  }

  const { summary, items } = data;

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('memoryRetention')}</h1>
      <p class="page-subtitle">${t('retentionSubtitle')}</p>
    </div>

    <div class="retention-summary">
      <div class="stat-card" data-accent="green">
        <div class="stat-label">${t('active')}</div>
        <div class="stat-value">${summary.active}</div>
      </div>
      <div class="stat-card" data-accent="amber">
        <div class="stat-label">${t('stale')}</div>
        <div class="stat-value">${summary.stale}</div>
      </div>
      <div class="stat-card" data-accent="cyan">
        <div class="stat-label">${t('archiveCandidates')}</div>
        <div class="stat-value">${summary.archive}</div>
      </div>
      <div class="stat-card" data-accent="purple">
        <div class="stat-label">${t('immune')}</div>
        <div class="stat-value">${summary.immune}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">${t('allObsByScore')}</span>
      </div>
      <div class="panel-body" style="padding: 0;">
        <table class="retention-table">
          <thead>
            <tr>
              <th>${t('id')}</th>
              <th>${t('title')}</th>
              <th>${t('type')}</th>
              <th>${t('entity')}</th>
              <th>${t('score')}</th>
              <th>${t('ageH')}</th>
              <th>${t('access')}</th>
              <th>${t('status')}</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => {
    const scorePercent = Math.min(item.score / 10 * 100, 100);
    const scoreColor = item.score >= 5 ? 'var(--accent-green)' : item.score >= 3 ? 'var(--accent-amber)' : item.score >= 1 ? 'var(--accent-red)' : 'var(--text-muted)';
    return `
                <tr>
                  <td style="font-family: var(--font-mono); color: var(--text-muted);">#${item.id}</td>
                  <td style="color: var(--text-primary); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.title || t('untitled'))}</td>
                  <td><span class="type-badge" data-type="${item.type}">${item.type}</span></td>
                  <td style="font-family: var(--font-mono); color: var(--text-muted); font-size: 12px;">${escapeHtml(item.entityName || '')}</td>
                  <td>
                    <div class="score-bar"><div class="score-bar-fill" style="width: ${scorePercent}%; background: ${scoreColor};"></div></div>
                    <span style="font-family: var(--font-mono); font-size: 12px; color: ${scoreColor};">${item.score}</span>
                  </td>
                  <td style="font-family: var(--font-mono); color: var(--text-muted); font-size: 12px;">${item.ageHours}h</td>
                  <td style="font-family: var(--font-mono); color: var(--text-muted); font-size: 12px;">${item.accessCount}</td>
                  <td>${item.isImmune ? `<span class="immune-badge">🛡️ ${t('immune')}</span>` : ''}</td>
                </tr>
              `;
  }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============================================================
// Observation Interactions
// ============================================================

function toggleObsDetail(id) {
  const detail = document.getElementById(`obs-detail-${id}`);
  const card = detail?.closest('.obs-card');
  if (!detail || !card) return;

  const isOpen = card.classList.contains('expanded');

  if (isOpen) {
    // Collapse: only animate max-height + opacity (inner div has padding/border)
    detail.style.transition = 'none';
    detail.style.maxHeight = detail.scrollHeight + 'px';
    detail.offsetHeight;
    detail.style.transition = '';
    requestAnimationFrame(() => {
      detail.style.maxHeight = '0';
      detail.style.opacity = '0';
    });
    const onEnd = (e) => {
      if (e.propertyName !== 'max-height') return;
      detail.removeEventListener('transitionend', onEnd);
      detail.style.display = 'none';
    };
    detail.addEventListener('transitionend', onEnd);
    card.classList.remove('expanded');
  } else {
    // Expand: only animate max-height + opacity
    detail.style.transition = 'none';
    detail.style.display = 'block';
    detail.style.maxHeight = '0';
    detail.style.opacity = '0';
    detail.offsetHeight;
    detail.style.transition = '';
    requestAnimationFrame(() => {
      detail.style.maxHeight = detail.scrollHeight + 'px';
      detail.style.opacity = '1';
    });
    const onEnd = (e) => {
      if (e.propertyName !== 'max-height') return;
      detail.removeEventListener('transitionend', onEnd);
      detail.style.maxHeight = 'none';
    };
    detail.addEventListener('transitionend', onEnd);
    card.classList.add('expanded');
  }

  // Rotate expand icon
  const icon = card.querySelector('.obs-expand-icon');
  if (icon) icon.style.transform = isOpen ? '' : 'rotate(180deg)';
}

async function deleteObs(id, event) {
  event?.stopPropagation();
  const msg = t('deleteConfirm').replace('%id%', id);
  if (!confirm(msg)) return;

  try {
    const sep = selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : '';
    const res = await fetch(`/api/observations/${id}${sep}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      // Remove from local array and re-render
      allObservations = allObservations.filter(o => o.id !== id);
      renderObsList();
      // Update counter in header
      const subtitle = document.querySelector('#page-observations .page-subtitle');
      if (subtitle) subtitle.textContent = `${allObservations.length} ${t('observationsStored')}`;
    } else {
      alert(data.error || 'Delete failed');
    }
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

// Make functions globally accessible for onclick handlers
window.toggleObsDetail = toggleObsDetail;
window.deleteObs = deleteObs;

// ============================================================
// Utilities
// ============================================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoString;
  }
}

function emptyState(icon, title, desc) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${icon}</div>
      <div class="empty-state-title">${title}</div>
      <div class="empty-state-desc">${desc}</div>
    </div>
  `;
}

// ============================================================
// Sessions Page
// ============================================================

async function loadSessions() {
  const container = document.getElementById('page-sessions');
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const sessions = await api('sessions');
  if (!sessions || sessions.length === 0) {
    container.innerHTML = emptyState('📋', t('noSessions'), t('noSessionsDesc'));
    return;
  }

  // Sort by startedAt descending (newest first)
  sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  const activeCount = sessions.filter(s => s.status === 'active').length;
  const completedCount = sessions.filter(s => s.status === 'completed').length;

  let html = `
    <div class="page-header">
      <h1 class="page-title">${t('sessions')}</h1>
      <p class="page-subtitle">${t('sessionsSubtitle')}</p>
    </div>

    <div class="retention-summary">
      <div class="stat-card" data-accent="green">
        <div class="stat-label">${t('sessionActive')}</div>
        <div class="stat-value">${activeCount}</div>
      </div>
      <div class="stat-card" data-accent="blue">
        <div class="stat-label">${t('sessionCompleted')}</div>
        <div class="stat-value">${completedCount}</div>
      </div>
      <div class="stat-card" data-accent="purple">
        <div class="stat-label">Total</div>
        <div class="stat-value">${sessions.length}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><span class="panel-title">Timeline</span></div>
      <div class="panel-body" style="padding: 0;">
        <table class="retention-table">
          <thead>
            <tr>
              <th>${t('status')}</th>
              <th>ID</th>
              <th>${t('sessionAgent')}</th>
              <th>${t('sessionStarted')}</th>
              <th>${t('sessionEnded')}</th>
              <th>${t('sessionSummary')}</th>
            </tr>
          </thead>
          <tbody>
  `;

  for (const s of sessions) {
    const statusBadge = s.status === 'active'
      ? '<span class="badge" style="background:var(--color-green);color:#fff">🟢 ' + t('sessionActive') + '</span>'
      : '<span class="badge" style="background:var(--color-blue);color:#fff">✅ ' + t('sessionCompleted') + '</span>';
    const agent = s.agent ? escapeHtml(s.agent) : '—';
    const started = formatTime(s.startedAt);
    const ended = s.endedAt ? formatTime(s.endedAt) : '—';
    const summary = s.summary
      ? escapeHtml(s.summary.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80)) + (s.summary.length > 80 ? '...' : '')
      : '—';

    html += `
      <tr>
        <td>${statusBadge}</td>
        <td><code>${escapeHtml(s.id)}</code></td>
        <td>${agent}</td>
        <td>${started}</td>
        <td>${ended}</td>
        <td>${summary}</td>
      </tr>
    `;
  }

  html += '</tbody></table></div></div>';
  container.innerHTML = html;
}

// ============================================================
// Init
// ============================================================

// Apply initial language to nav tooltips
setLang(currentLang);

loadPage('dashboard');
