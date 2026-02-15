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
  },
};

let currentLang = localStorage.getItem('memorix-lang') || 'en';

function t(key) {
  return (i18n[currentLang] && i18n[currentLang][key]) || i18n.en[key] || key;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('memorix-lang', lang);

  // Update button text
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = lang === 'en' ? '中' : 'EN';

  // Update nav tooltips
  const tooltipMap = { dashboard: 'navDashboard', graph: 'navGraph', observations: 'navObservations', retention: 'navRetention' };
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
  if (btn) {
    btn.textContent = currentLang === 'en' ? '中' : 'EN';
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
  if (sunIcon && moonIcon) {
    // Show sun icon in dark mode (click to go light), moon in light mode (click to go dark)
    sunIcon.style.display = theme === 'dark' ? 'none' : 'block';
    moonIcon.style.display = theme === 'dark' ? 'block' : 'none';
  }

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

const pages = ['dashboard', 'graph', 'observations', 'retention'];
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

async function api(endpoint) {
  try {
    const res = await fetch(`/api/${endpoint}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`API error (${endpoint}):`, err);
    return null;
  }
}

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
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">${t('observationTypes')}</span>
        </div>
        <div class="panel-body">
          ${typeEntries.length > 0 ? typeEntries.map(([type, count]) => `
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
              <span style="width: 20px; text-align: center;">${typeIcons[type] || '❓'}</span>
              <span style="width: 120px; font-size: 12px; color: var(--text-secondary);">${type}</span>
              <div style="flex: 1; height: 6px; background: rgba(255,255,255,0.04); border-radius: 3px; overflow: hidden;">
                <div style="width: ${(count / maxTypeCount) * 100}%; height: 100%; background: var(--type-${type}, var(--accent-cyan)); border-radius: 3px;"></div>
              </div>
              <span style="font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); min-width: 24px; text-align: right;">${count}</span>
            </div>
          `).join('') : `<p style="color: var(--text-muted); font-size: 13px;">${t('noObservationsYet')}</p>`}
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
// Canvas-based Force-Directed Graph (Enhanced)
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

  const typeColors = {};
  const palette = ['#00d4ff', '#a855f7', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#f97316'];
  let colorIdx = 0;
  function getTypeColor(type) {
    if (!typeColors[type]) { typeColors[type] = palette[colorIdx % palette.length]; colorIdx++; }
    return typeColors[type];
  }

  // Bigger nodes, wider spread
  const nodes = graph.entities.map((e) => ({
    id: e.name, type: e.entityType, observations: e.observations,
    x: W / 2 + (Math.random() - 0.5) * W * 0.7,
    y: H / 2 + (Math.random() - 0.5) * H * 0.7,
    vx: 0, vy: 0,
    radius: Math.min(10 + e.observations.length * 3, 32),
    color: getTypeColor(e.entityType),
  }));
  const nodeMap = {};
  nodes.forEach(n => nodeMap[n.id] = n);

  const edges = graph.relations
    .filter(r => nodeMap[r.from] && nodeMap[r.to])
    .map(r => ({ source: nodeMap[r.from], target: nodeMap[r.to], type: r.relationType }));

  // Stronger repulsion to fill the canvas
  const REPULSION = 8000;
  const ATTRACTION = 0.003;
  const DAMPING = 0.82;
  const CENTER_GRAVITY = 0.008;

  let animating = true;
  let hoveredNode = null;
  let selectedNode = null;
  let dragNode = null;
  let pulsePhase = 0;

  function simulate() {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let force = REPULSION / (dist * dist);
        let fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
    for (const edge of edges) {
      let dx = edge.target.x - edge.source.x, dy = edge.target.y - edge.source.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      let force = (dist - 150) * ATTRACTION;
      let fx = (dx / dist) * force, fy = (dy / dist) * force;
      edge.source.vx += fx; edge.source.vy += fy;
      edge.target.vx -= fx; edge.target.vy -= fy;
    }
    for (const node of nodes) {
      node.vx += (W / 2 - node.x) * CENTER_GRAVITY;
      node.vy += (H / 2 - node.y) * CENTER_GRAVITY;
    }
    let totalMovement = 0;
    for (const node of nodes) {
      if (node === dragNode) continue;
      node.vx *= DAMPING; node.vy *= DAMPING;
      node.x += node.vx; node.y += node.vy;
      node.x = Math.max(node.radius + 20, Math.min(W - node.radius - 20, node.x));
      node.y = Math.max(node.radius + 20, Math.min(H - node.radius - 20, node.y));
      totalMovement += Math.abs(node.vx) + Math.abs(node.vy);
    }
    return totalMovement;
  }

  function getGraphColors() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return {
      edgeNormal: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)',
      edgeHighlight: isLight ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.25)',
      edgeLabel: isLight ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)',
      labelNormal: isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.6)',
      labelHover: isLight ? '#1a1a2e' : '#ffffff',
    };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const colors = getGraphColors();
    pulsePhase += 0.02;

    // Edges with curve + arrow
    for (const edge of edges) {
      const isActive = (hoveredNode && (edge.source === hoveredNode || edge.target === hoveredNode))
        || (selectedNode && (edge.source === selectedNode || edge.target === selectedNode));
      const mx = (edge.source.x + edge.target.x) / 2;
      const my = (edge.source.y + edge.target.y) / 2;
      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      const ox = -dy * 0.08, oy = dx * 0.08;

      ctx.beginPath();
      ctx.moveTo(edge.source.x, edge.source.y);
      ctx.quadraticCurveTo(mx + ox, my + oy, edge.target.x, edge.target.y);
      ctx.strokeStyle = isActive ? colors.edgeHighlight : colors.edgeNormal;
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.stroke();

      // Arrow
      const as = isActive ? 8 : 5;
      const angle = Math.atan2(edge.target.y - (my + oy), edge.target.x - (mx + ox));
      const tx = edge.target.x - Math.cos(angle) * edge.target.radius;
      const ty = edge.target.y - Math.sin(angle) * edge.target.radius;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - as * Math.cos(angle - 0.3), ty - as * Math.sin(angle - 0.3));
      ctx.lineTo(tx - as * Math.cos(angle + 0.3), ty - as * Math.sin(angle + 0.3));
      ctx.closePath();
      ctx.fillStyle = isActive ? colors.edgeHighlight : colors.edgeNormal;
      ctx.fill();

      if (isActive) {
        ctx.font = '10px Inter, sans-serif';
        ctx.fillStyle = colors.edgeLabel;
        ctx.textAlign = 'center';
        ctx.fillText(edge.type, mx + ox, my + oy - 6);
      }
    }

    // Nodes
    for (const node of nodes) {
      const active = node === hoveredNode || node === selectedNode;

      // Glow + dashed ring
      if (active) {
        const pr = node.radius + 12 + Math.sin(pulsePhase * 3) * 3;
        ctx.beginPath();
        ctx.arc(node.x, node.y, pr, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(node.x, node.y, node.radius, node.x, node.y, pr);
        g.addColorStop(0, node.color + '30');
        g.addColorStop(1, node.color + '00');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = node.color + '50';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Main sphere with gradient
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      const ng = ctx.createRadialGradient(node.x - node.radius * 0.3, node.y - node.radius * 0.3, 0, node.x, node.y, node.radius);
      ng.addColorStop(0, node.color);
      ng.addColorStop(1, node.color + (active ? 'cc' : '99'));
      ctx.fillStyle = ng;
      ctx.fill();

      // Inner highlight
      ctx.beginPath();
      ctx.arc(node.x - node.radius * 0.2, node.y - node.radius * 0.2, node.radius * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fill();

      // Label
      ctx.font = `${active ? '600' : '400'} ${active ? 13 : 11}px Inter, sans-serif`;
      ctx.fillStyle = active ? colors.labelHover : colors.labelNormal;
      ctx.textAlign = 'center';
      ctx.fillText(node.id, node.x, node.y + node.radius + 18);

      // Obs count badge
      if (node.observations.length > 0) {
        const bx = node.x + node.radius * 0.6, by = node.y - node.radius * 0.6;
        ctx.beginPath();
        ctx.arc(bx, by, 8, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.font = 'bold 8px Inter, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(node.observations.length), bx, by);
        ctx.textBaseline = 'alphabetic';
      }
    }

    if (selectedNode && !animating) requestAnimationFrame(draw);
  }

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
        <div class="graph-detail-dot" style="background:${node.color}"></div>
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

  function tick() {
    const movement = simulate();
    draw();
    if (animating && movement > 0.1) requestAnimationFrame(tick);
  }

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (dragNode) { dragNode.x = mx; dragNode.y = my; dragNode.vx = 0; dragNode.vy = 0; draw(); return; }
    let found = null;
    for (const node of nodes) {
      const dx = mx - node.x, dy = my - node.y;
      if (dx * dx + dy * dy < (node.radius + 6) * (node.radius + 6)) { found = node; break; }
    }
    if (found !== hoveredNode) {
      hoveredNode = found;
      canvas.style.cursor = found ? 'pointer' : 'default';
      if (found) {
        const tt = document.getElementById('graph-tooltip');
        tt.querySelector('.graph-tooltip-name').textContent = found.id;
        tt.querySelector('.graph-tooltip-type').textContent = `${found.type} · ${found.observations.length} ${t('observation_s')}`;
        tt.style.left = (mx + 16) + 'px';
        tt.style.top = (my - 20) + 'px';
        tt.classList.add('visible');
      } else {
        document.getElementById('graph-tooltip').classList.remove('visible');
      }
      draw();
    }
  });
  canvas.addEventListener('mousedown', () => { if (hoveredNode) { dragNode = hoveredNode; canvas.style.cursor = 'grabbing'; } });
  canvas.addEventListener('mouseup', () => { if (dragNode) { dragNode = null; canvas.style.cursor = hoveredNode ? 'pointer' : 'default'; animating = true; tick(); } });
  canvas.addEventListener('click', () => { if (hoveredNode) { selectedNode = hoveredNode; showDetail(selectedNode); draw(); } });
  canvas.addEventListener('mouseleave', () => { hoveredNode = null; dragNode = null; document.getElementById('graph-tooltip').classList.remove('visible'); draw(); });

  tick();
  setTimeout(() => { animating = false; }, 8000);
}

// ============================================================
// Observations Page
// ============================================================

let allObservations = [];
let obsFilter = '';
let obsTypeFilter = '';

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
    <div class="page-header">
      <h1 class="page-title">${t('observations')}</h1>
      <p class="page-subtitle">${allObservations.length} ${t('observationsStored')}</p>
    </div>

    <div class="search-bar">
      <input class="search-input" id="obs-search" type="text" placeholder="${t('searchObservations')}" />
      <button class="filter-btn active" data-type="" id="filter-all">${t('all')}</button>
      ${types.map(tp => `<button class="filter-btn" data-type="${tp}">${tp}</button>`).join('')}
    </div>

    <div class="obs-grid" id="obs-list"></div>
  `;

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

  list.innerHTML = filtered.map(obs => `
    <div class="obs-card">
      <div class="obs-card-header">
        <span class="obs-card-id">#${obs.id}</span>
        <span class="type-badge" data-type="${obs.type || 'unknown'}">
          ${typeIcons[obs.type] || '❓'} ${obs.type || 'unknown'}
        </span>
        <span class="obs-card-title">${escapeHtml(obs.title || t('untitled'))}</span>
      </div>
      <div class="obs-card-meta">
        <span>📁 ${escapeHtml(obs.entityName || 'unknown')}</span>
        ${obs.createdAt ? `<span>🕐 ${formatTime(obs.createdAt)}</span>` : ''}
        ${obs.accessCount ? `<span>👁 ${obs.accessCount}</span>` : ''}
      </div>
      ${obs.narrative ? `<div class="obs-card-narrative">${escapeHtml(obs.narrative)}</div>` : ''}
      ${obs.facts && obs.facts.length > 0 ? `
        <div class="obs-card-facts">
          ${obs.facts.map(f => `<span class="fact-tag">${escapeHtml(f)}</span>`).join('')}
        </div>
      ` : ''}
    </div>
  `).join('');
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
// Init
// ============================================================

// Apply initial language to nav tooltips
setLang(currentLang);

loadPage('dashboard');
