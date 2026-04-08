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

    // Team
    teamTitle: 'Team',
    teamSubtitle: 'Multi-agent collaboration overview',
    teamNoData: 'Team features require HTTP transport',
    teamNoDataHint: 'Team collaboration (agents, file locks, tasks) requires the HTTP transport. Start it with:',
    teamActiveAgents: 'Active Agents',
    teamLockedFiles: 'Locked Files',
    teamTasks: 'Tasks',
    teamAvailable: 'Available',
    teamAgents: 'Agents',
    teamLocks: 'File Locks',
    teamTaskBoard: 'Task Board',

    // Overview (new)
    memoryControlPlane: 'Memory Control Plane',
    memoriesAcross: 'memories across',
    entitiesUnit: 'entities',
    gitMemories: 'Git Memories',
    agentMemories: 'Agent Memories',
    thisWeek: 'this week',
    hooksAndMcp: 'hooks + MCP',
    memorySources: 'Memory Sources',
    retentionHealth: 'Retention Health',
    sourceGit: 'Git',
    sourceAgent: 'Agent',
    sourceManual: 'Manual',

    // Git Memory
    gitMemoryTitle: 'Git Memory',
    gitMemorySubtitle: 'memories from git commits — ground truth, immutable',
    totalGitMemories: 'Total Git Memories',
    uniqueCommits: 'Unique Commits',
    typeCoverage: 'Type Coverage',
    noGitMemory: 'No Git Memory',
    noGitMemoryDesc: 'Install the post-commit hook with: memorix git-hook-install',
    noGitMemoriesYet: 'No Git Memories Yet',
    noGitMemoriesHint: 'Install the post-commit hook to automatically capture git memories:',
    recentGitMemories: 'Recent Git Memories',
    commit: 'Commit',
    created: 'Created',

    // Config
    configTitle: 'Config Provenance',
    configSubtitle: 'Where every configuration value comes from — two files, two roles',
    configSourceMatrix: 'Config Source Matrix',
    configHint: '= behavior config',
    configHintEnv: '= secrets only',
    valueProvenance: 'Value Provenance',
    trackedValues: 'tracked values',
    configKey: 'Key',
    configValue: 'Value',
    configSource: 'Source',
    configStatus: 'Status',
    moveToEnv: 'Move to .env',
    configUnavailable: 'Config Unavailable',
    configUnavailableDesc: 'Could not load configuration data',

    // Identity
    identityTitle: 'Project Identity Health',
    identitySubtitle: 'Project ID stability, aliases, and cross-agent consistency',
    healthStatus: 'Health Status',
    healthy: '✓ Healthy',
    unhealthy: '⚠ Issues',
    knownProjectIds: 'Known Project IDs',
    aliasGroups: 'Alias Groups',
    dirtyIds: 'Dirty IDs',
    currentIdentity: 'Current Identity',
    currentProjectId: 'Current Project ID',
    canonicalId: 'Canonical ID',
    aliases: 'Aliases',
    healthIssues: 'Health Issues',
    noIssues: 'No issues detected. Project identity is clean.',
    dirtyProjectIds: 'Dirty Project IDs',
    allKnownProjectIds: 'All Known Project IDs',
    tagCurrent: 'current',
    tagCanonical: 'canonical',
    tagDirty: 'dirty',
    identityUnavailable: 'Identity Unavailable',
    identityUnavailableDesc: 'Could not load project identity data',

    // System Health
    systemHealth: 'System Health',
    searchMode: 'Search Mode',
    embeddingProvider: 'Embedding Provider',
    backfillPending: 'Backfill Pending',
    vectorsMissing: 'vectors missing',
    noBackfillNeeded: 'All vectors indexed',
    providerReady: 'Ready',
    providerUnavailable: 'Unavailable',
    providerDisabled: 'Disabled (BM25 only)',
    degradedHint: 'Search is degraded — no vector similarity',

    // Nav tooltips
    navDashboard: 'Dashboard',
    navGitMemory: 'Git Memory',
    navGraph: 'Knowledge Graph',
    navObservations: 'Observations',
    navRetention: 'Retention',
    navConfig: 'Config',
    navIdentity: 'Identity',
    navSessions: 'Sessions',
    navTeam: 'Team',
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

    // Team
    teamTitle: '团队',
    teamSubtitle: '多 Agent 协作概览',
    teamNoData: '团队功能需要 HTTP 传输',
    teamNoDataHint: '团队协作（Agent 注册、文件锁、任务看板）需要 HTTP 传输模式。使用以下命令启动：',
    teamActiveAgents: '活跃 Agent',
    teamLockedFiles: '锁定文件',
    teamTasks: '任务',
    teamAvailable: '可领取',
    teamAgents: 'Agent 列表',
    teamLocks: '文件锁',
    teamTaskBoard: '任务看板',

    // Overview (new)
    memoryControlPlane: '记忆控制台',
    memoriesAcross: '条记忆，分布于',
    entitiesUnit: '个实体',
    gitMemories: 'Git 记忆',
    agentMemories: 'Agent 记忆',
    thisWeek: '本周新增',
    hooksAndMcp: 'hooks + MCP',
    memorySources: '记忆来源',
    retentionHealth: '衰减健康度',
    sourceGit: 'Git',
    sourceAgent: 'Agent',
    sourceManual: '手动',

    // Git Memory
    gitMemoryTitle: 'Git 记忆',
    gitMemorySubtitle: '来自 git 提交的记忆 — 不可变的事实源',
    totalGitMemories: 'Git 记忆总数',
    uniqueCommits: '唯一提交数',
    typeCoverage: '类型覆盖',
    noGitMemory: '暂无 Git 记忆',
    noGitMemoryDesc: '使用以下命令安装 post-commit hook: memorix git-hook-install',
    noGitMemoriesYet: '暂无 Git 记忆',
    noGitMemoriesHint: '安装 post-commit hook 以自动捕获 git 记忆：',
    recentGitMemories: '最近的 Git 记忆',
    commit: '提交',
    created: '创建时间',

    // Config
    configTitle: '配置溯源',
    configSubtitle: '每个配置值的来源 — 两个文件，两种角色',
    configSourceMatrix: '配置源矩阵',
    configHint: '= 行为配置',
    configHintEnv: '= 仅存放密钥',
    valueProvenance: '值的溯源',
    trackedValues: '个追踪值',
    configKey: '键',
    configValue: '值',
    configSource: '来源',
    configStatus: '状态',
    moveToEnv: '应移至 .env',
    configUnavailable: '配置不可用',
    configUnavailableDesc: '无法加载配置数据',

    // Identity
    identityTitle: '项目身份健康度',
    identitySubtitle: '项目 ID 稳定性、别名和跨 Agent 一致性',
    healthStatus: '健康状态',
    healthy: '✓ 健康',
    unhealthy: '⚠ 存在问题',
    knownProjectIds: '已知项目 ID',
    aliasGroups: '别名组',
    dirtyIds: '脏 ID',
    currentIdentity: '当前身份',
    currentProjectId: '当前项目 ID',
    canonicalId: '标准 ID',
    aliases: '别名',
    healthIssues: '健康问题',
    noIssues: '未检测到问题。项目身份状态良好。',
    dirtyProjectIds: '脏项目 ID',
    allKnownProjectIds: '所有已知项目 ID',
    tagCurrent: '当前',
    tagCanonical: '标准',
    tagDirty: '脏',
    identityUnavailable: '身份信息不可用',
    identityUnavailableDesc: '无法加载项目身份数据',

    // System Health
    systemHealth: '系统健康',
    searchMode: '搜索模式',
    embeddingProvider: '向量提供者',
    backfillPending: '回填待处理',
    vectorsMissing: '条向量缺失',
    noBackfillNeeded: '所有向量已索引',
    providerReady: '就绪',
    providerUnavailable: '不可用',
    providerDisabled: '已禁用 (仅 BM25)',
    degradedHint: '搜索已降级 — 无向量相似性',

    // Nav tooltips
    navDashboard: '仪表盘',
    navGitMemory: 'Git 记忆',
    navGraph: '知识图谱',
    navObservations: '观察记录',
    navRetention: '记忆衰减',
    navConfig: '配置溯源',
    navIdentity: '身份健康',
    navSessions: '会话',
    navTeam: '团队',
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
  const tooltipMap = { dashboard: 'navDashboard', graph: 'navGraph', observations: 'navObservations', retention: 'navRetention', sessions: 'navSessions', team: 'navTeam' };
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

const pages = ['dashboard', 'git-memory', 'graph', 'observations', 'retention', 'config', 'identity', 'sessions', 'team'];
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
    // Strategy: prefer URL param > isCurrent (if it has real data) > first project with most observations
    let active = null;
    if (urlProject) {
      const urlMatch = allProjects.find(p => p.id === urlProject);
      if (urlMatch) {
        active = urlMatch;
        selectedProject = urlMatch.id;
        Object.keys(loaded).forEach(k => delete loaded[k]);
        loadPage(currentPage);
      }
    }
    if (!active) {
      const current = allProjects.find(p => p.isCurrent);
      // Only use isCurrent if it's a real project with data (not __unresolved__ / system dir with 0 obs)
      if (current && current.count > 0 && current.id !== '__unresolved__') {
        active = current;
        selectedProject = current.id;
      } else {
        // Auto-select the first project with the most observations (list is pre-sorted by count desc)
        const firstReal = allProjects.find(p => p.count > 0 && p.id !== '__unresolved__');
        if (firstReal) {
          active = firstReal;
          selectedProject = firstReal.id;
        } else {
          active = current || allProjects[0];
          selectedProject = active?.id || '';
        }
      }
      Object.keys(loaded).forEach(k => delete loaded[k]);
      loadPage(currentPage);
    }

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

        selectedProject = project.id;
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
    case 'git-memory': await loadGitMemory(); break;
    case 'graph': await loadGraph(); break;
    case 'observations': await loadObservations(); break;
    case 'retention': await loadRetention(); break;
    case 'config': await loadConfig(); break;
    case 'identity': await loadIdentity(); break;
    case 'sessions': await loadSessions(); break;
    case 'team': await loadTeam(); break;
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
  const sc = stats.sourceCounts || { git: 0, agent: 0, manual: 0 };
  const totalObs = stats.observations || 0;
  const gs = stats.gitSummary || { total: 0, recentWeek: 0, recentMemories: [] };
  const rs = stats.retentionSummary || { active: 0, stale: 0, archive: 0, immune: 0 };

  const typeIcons = {
    'session-request': '🎯', gotcha: '🔴', 'problem-solution': '🟡',
    'how-it-works': '🔵', 'what-changed': '🟢', discovery: '🟣',
    'why-it-exists': '🟠', decision: '🟤', 'trade-off': '⚖️',
  };

  const typeEntries = Object.entries(stats.typeCounts || {}).sort((a, b) => b[1] - a[1]);
  const maxTypeCount = Math.max(...typeEntries.map(e => e[1]), 1);

  // Source bar percentages
  const srcTotal = Math.max(sc.git + sc.agent + sc.manual, 1);
  const gitPct = Math.round(sc.git / srcTotal * 100);
  const agentPct = Math.round(sc.agent / srcTotal * 100);
  const manualPct = 100 - gitPct - agentPct;

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('memoryControlPlane')} ${projectLabel ? `<span class="overview-project-badge">${escapeHtml(projectLabel)}</span>` : ''}</h1>
      <p class="page-subtitle">${totalObs} ${t('memoriesAcross')} ${stats.entities} ${t('entitiesUnit')}</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card" data-accent="green">
        <div class="stat-label">${t('gitMemories')}</div>
        <div class="stat-value">${sc.git}</div>
        <div class="stat-sub">${gs.recentWeek} ${t('thisWeek')}</div>
      </div>
      <div class="stat-card" data-accent="purple">
        <div class="stat-label">${t('agentMemories')}</div>
        <div class="stat-value">${sc.agent}</div>
        <div class="stat-sub">${t('hooksAndMcp')}</div>
      </div>
      <div class="stat-card" data-accent="cyan">
        <div class="stat-label">${t('entities')}</div>
        <div class="stat-value">${stats.entities}</div>
        <div class="stat-sub">${stats.relations} ${t('relations')}</div>
      </div>
      <div class="stat-card" data-accent="${stats.embedding?.enabled ? 'blue' : 'amber'}">
        <div class="stat-label">${t('vectorSearch')}</div>
        <div class="stat-value" style="font-size: 18px;">${stats.embedding?.enabled ? '✓ ' + t('enabled') : t('fulltextOnly')}</div>
        ${stats.embedding?.provider ? `<div class="stat-sub">${stats.embedding.provider} (${stats.embedding.dimensions}d)</div>` : ''}
      </div>
    </div>

    <!-- System Health -->
    <div class="overview-row">
      <div class="panel" style="flex:1;">
        <div class="panel-header"><span class="panel-title">${t('systemHealth')}</span></div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
            <div>
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">${t('embeddingProvider')}</div>
              <div style="font-size:14px;font-weight:600;color:${stats.embedding?.enabled ? 'var(--accent-green)' : stats.embedding?.provider ? 'var(--accent-amber)' : 'var(--text-muted)'};">
                ${stats.embedding?.enabled ? t('providerReady') : stats.embedding?.provider ? t('providerUnavailable') : t('providerDisabled')}
              </div>
              ${stats.embedding?.provider ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${stats.embedding.provider} (${stats.embedding.dimensions}d)</div>` : ''}
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">${t('backfillPending')}</div>
              <div style="font-size:14px;font-weight:600;color:${(stats.vectorStatus?.missing || 0) > 0 ? 'var(--accent-amber)' : 'var(--accent-green)'};">
                ${(stats.vectorStatus?.missing || 0) > 0 ? stats.vectorStatus.missing + ' ' + t('vectorsMissing') : t('noBackfillNeeded')}
              </div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">${t('searchMode')}</div>
              <div style="font-size:14px;font-weight:600;color:${
                (stats.searchMode || '').includes('hybrid') ? 'var(--accent-blue)'
                : (stats.searchMode || '').includes('vector') ? 'var(--accent-purple)'
                : (stats.searchMode || '').includes('rerank') ? 'var(--accent-green)'
                : 'var(--accent-amber)'};">
                ${stats.searchMode || (stats.embedding?.enabled ? 'hybrid' : 'fulltext')}
              </div>
              ${stats.embeddingProviderState === 'temporarily_unavailable' ? `<div style="font-size:11px;color:var(--accent-amber);margin-top:2px;">${t('degradedHint')}</div>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Source Breakdown -->
    <div class="overview-row">
      <div class="panel" style="flex:1;">
        <div class="panel-header"><span class="panel-title">${t('memorySources')}</span></div>
        <div class="panel-body">
          <div class="source-bar-container">
            <div class="source-bar">
              ${gitPct > 0 ? `<div class="source-bar-seg" style="width:${gitPct}%;background:var(--accent-green);" title="Git ${gitPct}%"></div>` : ''}
              ${agentPct > 0 ? `<div class="source-bar-seg" style="width:${agentPct}%;background:var(--accent-purple);" title="Agent ${agentPct}%"></div>` : ''}
              ${manualPct > 0 ? `<div class="source-bar-seg" style="width:${manualPct}%;background:var(--accent-amber);" title="Manual ${manualPct}%"></div>` : ''}
            </div>
            <div class="source-legend">
              <span class="source-legend-item"><span class="source-dot" style="background:var(--accent-green)"></span> ${t('sourceGit')} <strong>${sc.git}</strong></span>
              <span class="source-legend-item"><span class="source-dot" style="background:var(--accent-purple)"></span> ${t('sourceAgent')} <strong>${sc.agent}</strong></span>
              <span class="source-legend-item"><span class="source-dot" style="background:var(--accent-amber)"></span> ${t('sourceManual')} <strong>${sc.manual}</strong></span>
            </div>
          </div>
        </div>
      </div>

      <div class="panel" style="flex:1;">
        <div class="panel-header"><span class="panel-title">${t('retentionHealth')}</span></div>
        <div class="panel-body">
          <div class="retention-mini-grid">
            <div class="retention-mini-item"><span class="retention-mini-value" style="color:var(--accent-green)">${rs.active}</span><span class="retention-mini-label">${t('active')}</span></div>
            <div class="retention-mini-item"><span class="retention-mini-value" style="color:var(--accent-amber)">${rs.stale}</span><span class="retention-mini-label">${t('stale')}</span></div>
            <div class="retention-mini-item"><span class="retention-mini-value" style="color:var(--accent-red)">${rs.archive}</span><span class="retention-mini-label">${t('archiveCandidates')}</span></div>
            <div class="retention-mini-item"><span class="retention-mini-value" style="color:var(--accent-purple)">${rs.immune}</span><span class="retention-mini-label">${t('immune')}</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Type Distribution + Recent Activity -->
    <div class="overview-row">
      <div class="panel" style="flex:1;">
        <div class="panel-header"><span class="panel-title">${t('observationTypes')}</span></div>
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

      <div class="panel" style="flex:1;">
        <div class="panel-header"><span class="panel-title">${t('recentActivity')}</span></div>
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
// Memory Topology Explorer — Cytoscape.js + Dagre
// Focused topology default, not full graph dump
// ============================================================

let _graphState = null;

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
      <h1 class="page-title">Memory Topology</h1>
      <p class="page-subtitle">${graph.entities.length} entities · ${graph.relations.length} relations</p>
    </div>
    <div class="graph-layout">
      <div class="graph-filter-panel" id="graph-filter-panel"></div>
      <div id="graph-container">
        <div id="cytoscape-mount"></div>
        <div class="graph-status-bar">
          <span class="graph-status-item" id="gs-nodes"></span>
          <span class="graph-status-item" id="gs-edges"></span>
          <span class="graph-status-item" id="gs-layout"></span>
          <span class="graph-status-item" id="gs-scope"></span>
          <div class="graph-zoom-controls">
            <button class="graph-zoom-btn" id="gz-out">\u2212</button>
            <button class="graph-zoom-btn" id="gz-fit">\u2B21</button>
            <button class="graph-zoom-btn" id="gz-in">+</button>
          </div>
        </div>
      </div>
      <div class="graph-table-container" id="graph-table-container" style="display:none;"></div>
      <div class="graph-inspector" id="graph-inspector">
        <div class="gi-empty"><div class="gi-empty-icon">\u2B21</div>Select a node to inspect</div>
      </div>
    </div>
    <div id="graph-isolated-panel" style="display:none;"></div>
  `;

  renderGraph(graph);
}

// ============================================================
// Cytoscape.js + Dagre — Focused Topology Renderer
// Default: 1-hop neighborhood of top entity, dagre LR layout
// ============================================================

function renderGraph(graph) {
  // Register dagre layout if not already registered
  if (typeof cytoscape !== 'undefined' && typeof cytoscapeDagre !== 'undefined' && !cytoscape._dagreRegistered) {
    cytoscapeDagre(cytoscape);
    cytoscape._dagreRegistered = true;
  }

  // --- Muted enterprise palette ---
  const palette = [
    '#7C9CBF', '#8FB996', '#C4956A', '#A893C2',
    '#6BA3A0', '#B8A44C', '#C27878', '#7B8EB8',
  ];
  const typeColors = {};
  let colorIdx = 0;
  function getTypeColor(type) {
    if (!typeColors[type]) { typeColors[type] = palette[colorIdx % palette.length]; colorIdx++; }
    return typeColors[type];
  }

  const typeCounts = {};
  graph.entities.forEach(e => { typeCounts[e.entityType] = (typeCounts[e.entityType] || 0) + 1; });
  Object.keys(typeCounts).forEach(t2 => getTypeColor(t2));

  function isLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }

  // --- Build data structures ---
  const entityMap = {};
  graph.entities.forEach(e => {
    entityMap[e.name] = e;
  });

  // Compute degree for each entity
  const degreeMap = {};
  graph.entities.forEach(e => { degreeMap[e.name] = 0; });
  graph.relations.forEach(r => {
    if (degreeMap[r.from] !== undefined) degreeMap[r.from]++;
    if (degreeMap[r.to] !== undefined) degreeMap[r.to]++;
  });

  // Find top entity by degree (for default focus)
  const topEntity = graph.entities.reduce((best, e) =>
    (degreeMap[e.name] || 0) > (degreeMap[best.name] || 0) ? e : best,
    graph.entities[0]
  );

  // --- Computed stats ---
  const isolatedCount = graph.entities.filter(e => (degreeMap[e.name] || 0) === 0).length;
  const connectedCount = graph.entities.length - isolatedCount;
  const isSparse = isolatedCount > connectedCount;

  // --- State ---
  let activeTypes = new Set(Object.keys(typeCounts));
  let currentView = 'topology'; // 'topology' | 'table'
  let currentLayout = 'dagre-lr'; // 'dagre-lr' | 'dagre-tb'
  let focusEntity = topEntity.name;
  let depth = 1;
  let scope = 'connected'; // 'connected' | 'neighborhood' | 'full'
  let selectedNodeId = null;
  let cy = null; // Cytoscape instance

  // --- Subgraph extraction (BFS n-hop neighborhood) ---
  function getNeighborhood(centerName, maxDepth) {
    const visited = new Set();
    const edgeSet = new Set();
    const queue = [{ name: centerName, d: 0 }];
    visited.add(centerName);

    while (queue.length > 0) {
      const { name, d } = queue.shift();
      if (d >= maxDepth) continue;
      for (const r of graph.relations) {
        if (r.from === name && entityMap[r.to] && !visited.has(r.to)) {
          visited.add(r.to);
          edgeSet.add(r);
          queue.push({ name: r.to, d: d + 1 });
        } else if (r.from === name && entityMap[r.to]) {
          edgeSet.add(r);
        }
        if (r.to === name && entityMap[r.from] && !visited.has(r.from)) {
          visited.add(r.from);
          edgeSet.add(r);
          queue.push({ name: r.from, d: d + 1 });
        } else if (r.to === name && entityMap[r.from]) {
          edgeSet.add(r);
        }
      }
    }
    return {
      nodeNames: visited,
      edges: [...edgeSet].filter(r => visited.has(r.from) && visited.has(r.to)),
    };
  }

  // --- Build Cytoscape elements from current state ---
  function buildElements() {
    let nodeNames, visibleEdges;

    if (scope === 'full') {
      // Full graph canvas: only connected nodes (isolated go to inventory panel below)
      nodeNames = new Set(
        graph.entities.filter(e => activeTypes.has(e.entityType) && (degreeMap[e.name] || 0) > 0).map(e => e.name)
      );
      visibleEdges = graph.relations.filter(r => nodeNames.has(r.from) && nodeNames.has(r.to));
    } else if (scope === 'neighborhood') {
      // Focused neighborhood: BFS from focusEntity
      const sub = getNeighborhood(focusEntity, depth);
      nodeNames = new Set([...sub.nodeNames].filter(n => activeTypes.has(entityMap[n]?.entityType)));
      if (entityMap[focusEntity]) nodeNames.add(focusEntity);
      visibleEdges = sub.edges.filter(r => nodeNames.has(r.from) && nodeNames.has(r.to));
    } else {
      // DEFAULT: 'connected' — only nodes with degree > 0 (no isolated nodes)
      nodeNames = new Set(
        graph.entities
          .filter(e => activeTypes.has(e.entityType) && (degreeMap[e.name] || 0) > 0)
          .map(e => e.name)
      );
      visibleEdges = graph.relations.filter(r => nodeNames.has(r.from) && nodeNames.has(r.to));
    }

    // Top centrality: only top 3 show labels by default (not 10)
    const visibleDegrees = {};
    nodeNames.forEach(n => { visibleDegrees[n] = 0; });
    visibleEdges.forEach(r => {
      if (visibleDegrees[r.from] !== undefined) visibleDegrees[r.from]++;
      if (visibleDegrees[r.to] !== undefined) visibleDegrees[r.to]++;
    });
    const topCentrality = new Set(
      [...nodeNames].sort((a, b) => (visibleDegrees[b] || 0) - (visibleDegrees[a] || 0)).slice(0, 3)
    );

    const nodes = [...nodeNames].map(name => {
      const e = entityMap[name];
      const deg = visibleDegrees[name] || 0;
      const isFocus = scope === 'neighborhood' && name === focusEntity;
      const isTop = topCentrality.has(name);
      // Labels: only top 3 centrality nodes show labels by default
      const showLabel = isFocus || isTop;
      return {
        data: {
          id: name,
          label: showLabel ? (name.length > 24 ? name.slice(0, 22) + '\u2026' : name) : '',
          fullLabel: name,
          type: e.entityType,
          obsCount: e.observations.length,
          degree: deg,
          color: getTypeColor(e.entityType),
          isFocus: isFocus,
          nodeSize: Math.max(16, Math.min(12 + Math.sqrt(deg) * 6, 40)),
        },
      };
    });

    const edges = visibleEdges.map((r, i) => ({
      data: {
        id: 'e' + i + '_' + r.from + '_' + r.to,
        source: r.from,
        target: r.to,
        relationType: r.relationType,
      },
    }));

    return { nodes, edges, visibleCount: nodeNames.size, edgeCount: visibleEdges.length };
  }

  // --- Cytoscape style ---
  function getCyStyle() {
    const light = isLight();
    return [
      {
        selector: 'node',
        style: {
          'width': 'data(nodeSize)',
          'height': 'data(nodeSize)',
          'background-color': 'data(color)',
          'background-opacity': 0.85,
          'border-width': 1,
          'border-color': light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)',
          'label': 'data(label)',
          'font-size': 10,
          'font-family': 'Inter, system-ui, sans-serif',
          'font-weight': 400,
          'color': light ? '#1C1B1F' : '#E6E1E5',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 4,
          'text-max-width': 120,
          'text-wrap': 'ellipsis',
          'text-background-color': light ? '#F7F2FA' : '#0F0F17',
          'text-background-opacity': 0.7,
          'text-background-padding': '2px',
          'text-background-shape': 'roundrectangle',
          'min-zoomed-font-size': 8,
        },
      },
      {
        selector: 'node[?isFocus]',
        style: {
          'border-width': 3,
          'border-color': light ? '#6750A4' : '#D0BCFF',
          'font-weight': 600,
          'font-size': 12,
        },
      },
      {
        selector: 'node:selected',
        style: {
          'border-width': 3,
          'border-color': light ? '#6750A4' : '#D0BCFF',
          'border-style': 'dashed',
          'font-weight': 600,
          'label': 'data(fullLabel)',
        },
      },
      {
        selector: 'node.hover',
        style: {
          'border-width': 2,
          'border-color': light ? '#6750A4' : '#D0BCFF',
          'label': 'data(fullLabel)',
          'font-weight': 500,
          'z-index': 999,
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 1,
          'line-color': light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)',
          'target-arrow-color': light ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.7,
          'curve-style': 'bezier',
          'label': '',
        },
      },
      {
        selector: 'edge:selected, edge.hover',
        style: {
          'width': 2,
          'line-color': light ? 'rgba(103,80,164,0.5)' : 'rgba(208,188,255,0.4)',
          'target-arrow-color': light ? 'rgba(103,80,164,0.6)' : 'rgba(208,188,255,0.5)',
          'label': 'data(relationType)',
          'font-size': 9,
          'font-family': 'JetBrains Mono, monospace',
          'color': light ? '#6750A4' : '#D0BCFF',
          'text-background-color': light ? '#F7F2FA' : '#0F0F17',
          'text-background-opacity': 0.8,
          'text-background-padding': '2px',
          'text-background-shape': 'roundrectangle',
          'text-rotation': 'autorotate',
        },
      },
      {
        selector: '.dimmed',
        style: {
          'opacity': 0.15,
        },
      },
    ];
  }

  // --- Layout config ---
  function getLayoutConfig() {
    if (currentLayout === 'dagre-tb') {
      return { name: 'dagre', rankDir: 'TB', nodeSep: 40, rankSep: 60, edgeSep: 20, padding: 30 };
    }
    // Default: dagre LR
    return { name: 'dagre', rankDir: 'LR', nodeSep: 40, rankSep: 80, edgeSep: 20, padding: 30 };
  }

  // --- Initialize / rebuild Cytoscape ---
  function initCytoscape() {
    const { nodes, edges, visibleCount, edgeCount } = buildElements();

    if (cy) cy.destroy();

    const light = isLight();
    const mountEl = document.getElementById('cytoscape-mount');
    if (!mountEl) return;

    cy = cytoscape({
      container: mountEl,
      elements: [...nodes, ...edges],
      style: getCyStyle(),
      layout: getLayoutConfig(),
      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 4,
      boxSelectionEnabled: false,
    });

    // --- Event handlers ---
    cy.on('tap', 'node', function (evt) {
      const node = evt.target;
      selectedNodeId = node.id();
      showInspector(node.id());
    });

    cy.on('tap', function (evt) {
      if (evt.target === cy) {
        selectedNodeId = null;
        showInspector(null);
      }
    });

    let hoverNode = null;
    cy.on('mouseover', 'node', function (evt) {
      const node = evt.target;
      hoverNode = node;
      node.addClass('hover');
      // Show label on hover for all connected edges
      node.connectedEdges().addClass('hover');
    });
    cy.on('mouseout', 'node', function (evt) {
      const node = evt.target;
      if (hoverNode === node) hoverNode = null;
      node.removeClass('hover');
      node.connectedEdges().removeClass('hover');
    });

    // Double-click to refocus
    cy.on('dbltap', 'node', function (evt) {
      focusEntity = evt.target.id();
      scope = 'neighborhood';
      rebuildGraph();
    });

    updateStatusBar(visibleCount, edgeCount);
  }

  function rebuildGraph() {
    initCytoscape();
    renderFilterPanel();
    renderIsolatedPanel();
  }

  // --- Isolated Entities Inventory (not in graph canvas) ---
  function renderIsolatedPanel() {
    const panel = document.getElementById('graph-isolated-panel');
    if (!panel) return;

    // Only show when scope is connected or full (not neighborhood)
    if (scope === 'neighborhood') {
      panel.style.display = 'none';
      return;
    }

    const isolated = graph.entities.filter(e =>
      activeTypes.has(e.entityType) && (degreeMap[e.name] || 0) === 0
    );

    if (isolated.length === 0) {
      panel.style.display = 'none';
      return;
    }

    // Group by entityType
    const groups = {};
    isolated.forEach(e => {
      (groups[e.entityType] = groups[e.entityType] || []).push(e);
    });

    const groupEntries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="panel" style="margin-top:16px;">
        <div class="panel-header">
          <span class="panel-title">Isolated Entities</span>
          <span style="font-size:11px;color:var(--text-muted);">${isolated.length} entities with no relations \u2014 shown separately for readability</span>
        </div>
        <div class="panel-body" style="padding:12px 16px;">
          ${groupEntries.map(([type, entities]) => {
            const color = getTypeColor(type);
            const collapsed = entities.length > 8;
            const shown = collapsed ? entities.slice(0, 8) : entities;
            return `
              <div style="margin-bottom:12px;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                  <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
                  <span style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(type)}</span>
                  <span style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">${entities.length}</span>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">
                  ${shown.map(e => `
                    <span class="iso-entity-tag" data-iso-entity="${escapeHtml(e.name)}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;font-size:11px;color:var(--text-secondary);background:var(--bg-surface);border:1px solid var(--border-subtle);cursor:pointer;transition:all 150ms;">
                      ${escapeHtml(e.name.length > 28 ? e.name.slice(0, 26) + '\u2026' : e.name)}
                      ${e.observations.length > 0 ? '<span style="font-size:9px;color:var(--text-muted);">' + e.observations.length + '</span>' : ''}
                    </span>
                  `).join('')}
                  ${collapsed ? '<span style="font-size:11px;color:var(--text-muted);padding:3px 8px;">+' + (entities.length - 8) + ' more</span>' : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Bind clicks: inspect isolated entity
    panel.querySelectorAll('[data-iso-entity]').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.dataset.isoEntity;
        if (entityMap[name]) {
          selectedNodeId = name;
          showInspector(name);
        }
      });
    });
  }

  // --- Inspector ---
  function showInspector(nodeId) {
    const inspector = document.getElementById('graph-inspector');
    if (!inspector) return;
    if (!nodeId || !entityMap[nodeId]) {
      inspector.innerHTML = '<div class="gi-empty"><div class="gi-empty-icon">\u2B21</div>Select a node to inspect</div>';
      return;
    }
    const entity = entityMap[nodeId];
    const related = graph.relations.filter(r => r.from === nodeId || r.to === nodeId);
    const deg = degreeMap[nodeId] || 0;
    const color = getTypeColor(entity.entityType);

    const obsHtml = entity.observations.length > 0
      ? entity.observations.map(o => `<div class="gi-obs-item">${escapeHtml(o)}</div>`).join('')
      : '<div style="font-size:12px;color:var(--text-muted);font-style:italic;">No observations</div>';
    const relHtml = related.length > 0
      ? related.map(r => {
        const dir = r.from === nodeId;
        const other = dir ? r.to : r.from;
        return `<div class="gi-rel-item">
          <span class="gi-rel-arrow">${dir ? '\u2192' : '\u2190'}</span>
          <span class="gi-rel-type">${escapeHtml(r.relationType)}</span>
          <span class="gi-rel-target" data-inspector-nav="${escapeHtml(other)}">${escapeHtml(other)}</span>
        </div>`;
      }).join('')
      : '<div style="font-size:12px;color:var(--text-muted);font-style:italic;">No relations</div>';

    inspector.innerHTML = `
      <div class="gi-header">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          <div class="gi-name">${escapeHtml(nodeId)}</div>
        </div>
        <div class="gi-type">${escapeHtml(entity.entityType)}</div>
      </div>
      <div class="gi-stats">
        <div class="gi-stat"><div class="gi-stat-value">${deg}</div><div class="gi-stat-label">Connections</div></div>
        <div class="gi-stat"><div class="gi-stat-value">${entity.observations.length}</div><div class="gi-stat-label">Evidence</div></div>
      </div>
      <div class="gi-section">
        <div class="gi-section-title">Observations <span class="gi-section-count">${entity.observations.length}</span></div>
        ${obsHtml}
      </div>
      <div class="gi-section">
        <div class="gi-section-title">Relations <span class="gi-section-count">${related.length}</span></div>
        ${relHtml}
      </div>
    `;

    // Navigation: click relation target to focus
    inspector.querySelectorAll('[data-inspector-nav]').forEach(el => {
      el.addEventListener('click', () => {
        const targetId = el.dataset.inspectorNav;
        if (entityMap[targetId]) {
          selectedNodeId = targetId;
          // If target is visible in current graph, select it
          if (cy && cy.$id(targetId).length > 0) {
            cy.$(':selected').unselect();
            cy.$id(targetId).select();
            cy.animate({ center: { eles: cy.$id(targetId) }, duration: 300 });
          } else {
            // Switch focus to target
            focusEntity = targetId;
            scope = 'neighborhood';
            rebuildGraph();
          }
          showInspector(targetId);
        }
      });
    });
  }

  // --- Filter panel ---
  function renderFilterPanel() {
    const panel = document.getElementById('graph-filter-panel');
    if (!panel) return;

    const searchHtml = `
      <div class="gfp-section">
        <div class="gfp-label">Search</div>
        <input type="text" class="gfp-search" id="gfp-search" placeholder="Find entity..." autocomplete="off" />
      </div>
    `;

    const scopeHtml = `
      <div class="gfp-section">
        <div class="gfp-label">Scope</div>
        <div class="gfp-radio-group">
          <button class="gfp-radio${scope === 'connected' ? ' active' : ''}" data-scope="connected">
            <span class="gfp-radio-dot"></span> Connected
          </button>
          <button class="gfp-radio${scope === 'neighborhood' ? ' active' : ''}" data-scope="neighborhood">
            <span class="gfp-radio-dot"></span> Neighborhood
          </button>
          <button class="gfp-radio${scope === 'full' ? ' active' : ''}" data-scope="full">
            <span class="gfp-radio-dot"></span> Full Graph
          </button>
        </div>
        ${isSparse ? `<div style="font-size:10px;color:var(--accent-amber);margin-top:6px;line-height:1.4;">\u26A0 Sparse graph: ${isolatedCount} of ${graph.entities.length} entities have no relations. Isolated entities shown in inventory below.</div>` : ''}
      </div>
    `;

    const depthHtml = `
      <div class="gfp-section" id="gfp-depth-section"${scope !== 'neighborhood' ? ' style="display:none"' : ''}>
        <div class="gfp-label">Depth</div>
        <div class="gfp-depth-row">
          <button class="gfp-depth-btn${depth === 1 ? ' active' : ''}" data-depth="1">1</button>
          <button class="gfp-depth-btn${depth === 2 ? ' active' : ''}" data-depth="2">2</button>
          <button class="gfp-depth-btn${depth === 3 ? ' active' : ''}" data-depth="3">3</button>
        </div>
      </div>
    `;

    const viewHtml = `
      <div class="gfp-section">
        <div class="gfp-label">View</div>
        <div class="gfp-radio-group">
          <button class="gfp-radio${currentView === 'topology' ? ' active' : ''}" data-view="topology">
            <span class="gfp-radio-dot"></span> Topology
          </button>
          <button class="gfp-radio${currentView === 'table' ? ' active' : ''}" data-view="table">
            <span class="gfp-radio-dot"></span> Table
          </button>
        </div>
      </div>
    `;

    const layoutHtml = `
      <div class="gfp-section" id="gfp-layout-section"${currentView === 'table' ? ' style="display:none"' : ''}>
        <div class="gfp-label">Layout</div>
        <div class="gfp-radio-group">
          <button class="gfp-radio${currentLayout === 'dagre-lr' ? ' active' : ''}" data-layout="dagre-lr">
            <span class="gfp-radio-dot"></span> Left \u2192 Right
          </button>
          <button class="gfp-radio${currentLayout === 'dagre-tb' ? ' active' : ''}" data-layout="dagre-tb">
            <span class="gfp-radio-dot"></span> Top \u2192 Bottom
          </button>
        </div>
      </div>
    `;

    const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const filterHtml = `
      <div class="gfp-section">
        <div class="gfp-label">Entity Type</div>
        <div class="gfp-radio-group">
          ${typeEntries.map(([type, count]) => `
            <button class="gfp-check${activeTypes.has(type) ? ' active' : ''}" data-type-filter="${escapeHtml(type)}">
              <span class="gfp-check-box">\u2713</span>
              <span class="gfp-type-dot" style="background:${typeColors[type]}"></span>
              ${escapeHtml(type)}
              <span class="gfp-check-count">${count}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    panel.innerHTML = searchHtml + scopeHtml + depthHtml + viewHtml + layoutHtml + filterHtml;

    // Bind scope
    panel.querySelectorAll('[data-scope]').forEach(btn => {
      btn.addEventListener('click', () => {
        scope = btn.dataset.scope;
        rebuildGraph();
      });
    });

    // Bind depth
    panel.querySelectorAll('[data-depth]').forEach(btn => {
      btn.addEventListener('click', () => {
        depth = parseInt(btn.dataset.depth);
        rebuildGraph();
      });
    });

    // Bind view
    panel.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentView = btn.dataset.view;
        switchView();
        renderFilterPanel();
      });
    });

    // Bind layout
    panel.querySelectorAll('[data-layout]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentLayout = btn.dataset.layout;
        if (cy) {
          cy.layout(getLayoutConfig()).run();
        }
        renderFilterPanel();
      });
    });

    // Bind type filters
    panel.querySelectorAll('[data-type-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.typeFilter;
        if (activeTypes.has(type)) activeTypes.delete(type);
        else activeTypes.add(type);
        rebuildGraph();
      });
    });

    // Bind search — focus on entity and navigate
    const searchInput = document.getElementById('gfp-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase();
        if (!q || !cy) {
          if (cy) cy.elements().removeClass('dimmed');
          return;
        }
        cy.nodes().forEach(n => {
          const match = n.data('fullLabel').toLowerCase().includes(q) || n.data('type').toLowerCase().includes(q);
          if (match) { n.removeClass('dimmed'); } else { n.addClass('dimmed'); }
        });
        cy.edges().forEach(e => {
          if (e.source().hasClass('dimmed') && e.target().hasClass('dimmed')) e.addClass('dimmed');
          else e.removeClass('dimmed');
        });
      });

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const q = searchInput.value.toLowerCase();
          const match = graph.entities.find(ent => ent.name.toLowerCase().includes(q));
          if (match) {
            focusEntity = match.name;
            scope = 'neighborhood';
            rebuildGraph();
          }
        }
      });
    }
  }

  function switchView() {
    const graphContainer = document.getElementById('graph-container');
    const tableContainer = document.getElementById('graph-table-container');
    if (currentView === 'table') {
      graphContainer.style.display = 'none';
      tableContainer.style.display = 'flex';
      renderTable();
    } else {
      graphContainer.style.display = '';
      tableContainer.style.display = 'none';
    }
  }

  // --- Table view ---
  function renderTable() {
    const tc = document.getElementById('graph-table-container');
    if (!tc) return;
    let entities;
    if (scope === 'full') {
      entities = graph.entities.filter(e => activeTypes.has(e.entityType) && (degreeMap[e.name] || 0) > 0);
    } else if (scope === 'neighborhood') {
      const sub = getNeighborhood(focusEntity, depth);
      entities = [...sub.nodeNames].filter(n => activeTypes.has(entityMap[n]?.entityType)).map(n => entityMap[n]).filter(Boolean);
    } else {
      // connected: only degree > 0
      entities = graph.entities.filter(e => activeTypes.has(e.entityType) && (degreeMap[e.name] || 0) > 0);
    }
    const sorted = entities.sort((a, b) => (degreeMap[b.name] || 0) - (degreeMap[a.name] || 0));
    tc.innerHTML = `
      <table class="graph-table">
        <thead>
          <tr>
            <th>Entity</th>
            <th>Type</th>
            <th>Connections</th>
            <th>Observations</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(e => `
            <tr data-table-node="${escapeHtml(e.name)}">
              <td class="entity-name"><span class="entity-type-dot" style="background:${getTypeColor(e.entityType)}"></span>${escapeHtml(e.name)}</td>
              <td>${escapeHtml(e.entityType)}</td>
              <td>${degreeMap[e.name] || 0}</td>
              <td>${e.observations.length}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tc.querySelectorAll('[data-table-node]').forEach(row => {
      row.addEventListener('click', () => {
        selectedNodeId = row.dataset.tableNode;
        showInspector(selectedNodeId);
      });
    });
  }

  // --- Status bar ---
  function updateStatusBar(nodeCount, edgeCount) {
    const gsNodes = document.getElementById('gs-nodes');
    const gsEdges = document.getElementById('gs-edges');
    const gsLayout = document.getElementById('gs-layout');
    const gsScope = document.getElementById('gs-scope');
    if (gsNodes) gsNodes.textContent = `${nodeCount || 0} nodes`;
    if (gsEdges) gsEdges.textContent = `${edgeCount || 0} edges`;
    if (gsLayout) gsLayout.textContent = currentLayout === 'dagre-tb' ? 'TB' : 'LR';
    if (gsScope) gsScope.textContent = scope === 'full' ? 'full' : scope === 'neighborhood' ? `${depth}-hop` : 'connected';
    if (isolatedCount > 0 && scope !== 'neighborhood') {
      if (gsScope) gsScope.textContent += ` · ${isolatedCount} isolated below`;
    }
  }

  // --- Zoom controls ---
  const gzIn = document.getElementById('gz-in');
  const gzOut = document.getElementById('gz-out');
  const gzFit = document.getElementById('gz-fit');
  if (gzIn) gzIn.onclick = () => { if (cy) cy.zoom(cy.zoom() * 1.3); };
  if (gzOut) gzOut.onclick = () => { if (cy) cy.zoom(cy.zoom() / 1.3); };
  if (gzFit) gzFit.onclick = () => { if (cy) cy.fit(undefined, 30); };

  // --- Initialize ---
  _graphState = { graph, entityMap, degreeMap, typeColors, showInspector };
  initCytoscape();
  renderFilterPanel();
  renderIsolatedPanel();
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
// Git Memory Page
// ============================================================

async function loadGitMemory() {
  const container = document.getElementById('page-git-memory');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const [stats, allObs] = await Promise.all([api('stats'), api('observations')]);
  if (!stats || !allObs) {
    container.innerHTML = emptyState('🔀', t('noGitMemory'), t('noGitMemoryDesc'));
    return;
  }

  const gitObs = (allObs || []).filter(o => o.source === 'git').sort((a, b) => (b.id || 0) - (a.id || 0));
  const gs = stats.gitSummary || { total: 0, recentWeek: 0, recentMemories: [] };
  const sc = stats.sourceCounts || {};

  // Type breakdown of git memories
  const gitTypes = {};
  gitObs.forEach(o => { gitTypes[o.type || 'unknown'] = (gitTypes[o.type || 'unknown'] || 0) + 1; });
  const gitTypeEntries = Object.entries(gitTypes).sort((a, b) => b[1] - a[1]);

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('gitMemoryTitle')}</h1>
      <p class="page-subtitle">${gitObs.length} ${t('gitMemorySubtitle')}</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card" data-accent="green">
        <div class="stat-label">${t('totalGitMemories')}</div>
        <div class="stat-value">${gitObs.length}</div>
      </div>
      <div class="stat-card" data-accent="cyan">
        <div class="stat-label">${t('thisWeek')}</div>
        <div class="stat-value">${gs.recentWeek}</div>
      </div>
      <div class="stat-card" data-accent="purple">
        <div class="stat-label">${t('uniqueCommits')}</div>
        <div class="stat-value">${new Set(gitObs.map(o => o.commitHash).filter(Boolean)).size}</div>
      </div>
      <div class="stat-card" data-accent="amber">
        <div class="stat-label">${t('typeCoverage')}</div>
        <div class="stat-value">${gitTypeEntries.length}</div>
        <div class="stat-sub">${gitTypeEntries.slice(0, 3).map(([t]) => t).join(', ')}</div>
      </div>
    </div>

    ${gitObs.length === 0 ? `
      <div class="panel">
        <div class="panel-body" style="text-align:center;padding:48px;">
          <div style="font-size:36px;margin-bottom:12px;">🔀</div>
          <div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">${t('noGitMemoriesYet')}</div>
          <div style="font-size:13px;color:var(--text-muted);max-width:400px;margin:0 auto;">
            ${t('noGitMemoriesHint')}<br>
            <code style="background:var(--bg-surface);padding:4px 10px;border-radius:6px;margin-top:8px;display:inline-block;font-size:12px;">memorix git-hook-install</code>
          </div>
        </div>
      </div>
    ` : `
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">${t('recentGitMemories')}</span>
          <span style="font-size:11px;color:var(--text-muted);">${gitObs.length} total</span>
        </div>
        <div class="panel-body" style="padding:0;">
          <table class="retention-table">
            <thead>
              <tr>
                <th>${t('id')}</th>
                <th>${t('commit')}</th>
                <th>${t('title')}</th>
                <th>${t('type')}</th>
                <th>${t('entity')}</th>
                <th>${t('files')}</th>
                <th>${t('created')}</th>
              </tr>
            </thead>
            <tbody>
              ${gitObs.slice(0, 50).map(obs => `
                <tr>
                  <td style="font-family:var(--font-mono);color:var(--text-muted);">#${obs.id}</td>
                  <td><code class="git-hash">${obs.commitHash ? escapeHtml(obs.commitHash.slice(0, 7)) : '—'}</code></td>
                  <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(obs.title || 'Untitled')}</td>
                  <td><span class="type-badge" data-type="${obs.type || 'unknown'}">${obs.type || 'unknown'}</span></td>
                  <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);">${escapeHtml(obs.entityName || '')}</td>
                  <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);">${(obs.filesModified || []).length || '—'}</td>
                  <td style="font-size:11px;color:var(--text-muted);">${obs.createdAt ? formatTime(obs.createdAt) : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;
}

// ============================================================
// Config Provenance Page
// ============================================================

async function loadConfig() {
  const container = document.getElementById('page-config');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const data = await api('config');
  if (!data) {
    container.innerHTML = emptyState('⚙️', t('configUnavailable'), t('configUnavailableDesc'));
    return;
  }

  const fileEntries = Object.entries(data.files || {});
  const values = data.values || [];

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('configTitle')}</h1>
      <p class="page-subtitle">${t('configSubtitle')}</p>
    </div>

    <div class="overview-row">
      <div class="panel" style="flex:1;">
        <div class="panel-header"><span class="panel-title">${t('configSourceMatrix')}</span></div>
        <div class="panel-body">
          <div class="config-matrix">
            ${fileEntries.map(([name, info]) => `
              <div class="config-file-row">
                <span class="config-file-status ${info.exists ? 'exists' : 'missing'}">${info.exists ? '✓' : '✗'}</span>
                <span class="config-file-name">${escapeHtml(name)}</span>
                <span class="config-file-path">${info.path ? escapeHtml(info.path) : ''}</span>
              </div>
            `).join('')}
          </div>
          <div class="config-hint">
            <strong>memorix.yml</strong> ${t('configHint')} &nbsp;|&nbsp; <strong>.env</strong> ${t('configHintEnv')}
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">${t('valueProvenance')}</span>
        <span style="font-size:11px;color:var(--text-muted);">${values.length} ${t('trackedValues')}</span>
      </div>
      <div class="panel-body" style="padding:0;">
        <table class="retention-table">
          <thead>
            <tr>
              <th>${t('configKey')}</th>
              <th>${t('configValue')}</th>
              <th>${t('configSource')}</th>
              <th>${t('configStatus')}</th>
            </tr>
          </thead>
          <tbody>
            ${values.map(v => {
              const isWarn = v.source && v.source.includes('move to .env');
              const isSensitive = v.sensitive;
              return `
                <tr>
                  <td><code class="config-key">${escapeHtml(v.key)}</code></td>
                  <td style="font-family:var(--font-mono);font-size:12px;">${isSensitive ? '<span class="config-masked">' + escapeHtml(v.value) + '</span>' : escapeHtml(v.value)}</td>
                  <td><span class="config-source-badge ${isWarn ? 'warn' : ''}">${escapeHtml(v.source)}</span></td>
                  <td>${isWarn ? '<span class="config-warn-badge">⚠ ' + t('moveToEnv') + '</span>' : ''}</td>
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
// Identity Health Page
// ============================================================

async function loadIdentity() {
  const container = document.getElementById('page-identity');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const data = await api('identity');
  if (!data) {
    container.innerHTML = emptyState('🛡️', t('identityUnavailable'), t('identityUnavailableDesc'));
    return;
  }

  const healthColor = data.isHealthy ? 'var(--accent-green)' : 'var(--accent-red)';
  const healthIcon = data.isHealthy ? t('healthy') : t('unhealthy');

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('identityTitle')}</h1>
      <p class="page-subtitle">${t('identitySubtitle')}</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card" data-accent="${data.isHealthy ? 'green' : 'red'}">
        <div class="stat-label">${t('healthStatus')}</div>
        <div class="stat-value" style="font-size:20px;color:${healthColor}">${healthIcon}</div>
      </div>
      <div class="stat-card" data-accent="cyan">
        <div class="stat-label">${t('knownProjectIds')}</div>
        <div class="stat-value">${data.allProjectIds?.length || 0}</div>
      </div>
      <div class="stat-card" data-accent="purple">
        <div class="stat-label">${t('aliasGroups')}</div>
        <div class="stat-value">${data.aliasGroups || 0}</div>
      </div>
      <div class="stat-card" data-accent="amber">
        <div class="stat-label">${t('dirtyIds')}</div>
        <div class="stat-value">${data.dirtyIds?.length || 0}</div>
      </div>
    </div>

    <div class="overview-row">
      <div class="panel" style="flex:1;">
        <div class="panel-header"><span class="panel-title">${t('currentIdentity')}</span></div>
        <div class="panel-body">
          <div class="identity-row">
            <span class="identity-label">${t('currentProjectId')}</span>
            <code class="identity-value">${escapeHtml(data.currentProjectId || '—')}</code>
          </div>
          <div class="identity-row">
            <span class="identity-label">${t('canonicalId')}</span>
            <code class="identity-value">${escapeHtml(data.canonicalId || '—')}</code>
          </div>
          <div class="identity-row">
            <span class="identity-label">${t('aliases')}</span>
            <div>${(data.aliases || []).map(a => `<code class="identity-alias">${escapeHtml(a)}</code>`).join(' ')}</div>
          </div>
        </div>
      </div>

      <div class="panel" style="flex:1;">
        <div class="panel-header"><span class="panel-title">${t('healthIssues')}</span></div>
        <div class="panel-body">
          ${(data.healthIssues || []).length === 0
            ? '<div style="color:var(--accent-green);font-size:13px;">' + t('noIssues') + '</div>'
            : (data.healthIssues || []).map(issue => `
                <div class="identity-issue">
                  <span style="color:var(--accent-red);">⚠</span>
                  <span>${escapeHtml(issue)}</span>
                </div>
              `).join('')
          }
        </div>
      </div>
    </div>

    ${(data.dirtyIds || []).length > 0 ? `
      <div class="panel">
        <div class="panel-header"><span class="panel-title">${t('dirtyProjectIds')}</span></div>
        <div class="panel-body">
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${data.dirtyIds.map(id => `<code class="identity-dirty">${escapeHtml(id)}</code>`).join('')}
          </div>
        </div>
      </div>
    ` : ''}

    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">${t('allKnownProjectIds')}</span>
        <span style="font-size:11px;color:var(--text-muted);">${data.allProjectIds?.length || 0} total</span>
      </div>
      <div class="panel-body">
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${(data.allProjectIds || []).map(id => {
            const isDirty = (data.dirtyIds || []).includes(id);
            const isCurrent = id === data.currentProjectId;
            const isCanonical = id === data.canonicalId;
            return `<div class="identity-id-row">
              <code class="identity-id ${isDirty ? 'dirty' : ''}">${escapeHtml(id)}</code>
              ${isCurrent ? '<span class="identity-tag current">' + t('tagCurrent') + '</span>' : ''}
              ${isCanonical ? '<span class="identity-tag canonical">' + t('tagCanonical') + '</span>' : ''}
              ${isDirty ? '<span class="identity-tag dirty">' + t('tagDirty') + '</span>' : ''}
            </div>`;
          }).join('')}
        </div>
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
// Team Page
// ============================================================

let teamRefreshTimer = null;

function teamTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return sec + 's ago';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  return Math.floor(hr / 24) + 'd ago';
}

function teamLockTTL(expiresAt) {
  if (!expiresAt) return '';
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return 'expired';
  const min = Math.floor(remaining / 60000);
  return min + 'm left';
}

let teamScope = 'project'; // 'project' | 'global'

async function loadTeam() {
  const container = document.getElementById('page-team');
  if (!container.innerHTML || container.innerHTML.includes('spinner')) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  }

  const data = await api('team?scope=' + teamScope);
  if (!data || data.unavailable) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">${t('teamTitle')}</h1>
        <p class="page-subtitle">${t('teamSubtitle')}</p>
      </div>
      <div class="panel">
        <div class="panel-body" style="text-align:center;padding:48px;">
          <div style="font-size:36px;margin-bottom:12px;">👥</div>
          <div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">${t('teamNoData')}</div>
          <div style="font-size:13px;color:var(--text-muted);max-width:480px;margin:0 auto;line-height:1.6;">
            ${t('teamNoDataHint')}<br>
            <code style="background:var(--bg-surface);padding:4px 10px;border-radius:6px;margin-top:8px;display:inline-block;font-size:12px;">memorix serve-http --port 3211</code>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const statusIcons = {
    pending: 'lucide:circle-dashed',
    in_progress: 'lucide:loader',
    completed: 'lucide:circle-check',
    failed: 'lucide:circle-x',
  };
  const statusLabels = { pending: 'Pending', in_progress: 'In Progress', completed: 'Done', failed: 'Failed' };

  const totalAgents = data.agents.length;
  const inactiveAgents = data.agents.filter(a => a.status !== 'active').length;
  const totalUnread = data.agents.reduce((sum, a) => sum + (a.unread || 0), 0);
  const tasksByStatus = { pending: 0, in_progress: 0, completed: 0, failed: 0 };
  data.tasks.forEach(tk => { tasksByStatus[tk.status] = (tasksByStatus[tk.status] || 0) + 1; });

  const scopeLabel = teamScope === 'global' ? 'Global Team' : 'Project Team';
  const scopeDesc = teamScope === 'global'
    ? 'All agents across projects (runtime + persisted)'
    : 'Agents active in current control-plane session';

  let html = `
    <div class="team-header">
      <div class="team-header-left">
        <div class="team-header-icon">
          <span class="iconify" data-icon="lucide:users"></span>
        </div>
        <div>
          <h1 class="page-title">${scopeLabel}</h1>
          <p class="page-subtitle">${scopeDesc}${data.sessions != null ? ' &middot; ' + data.sessions + ' session(s)' : ''}</p>
        </div>
      </div>
      <div class="team-header-right">
        <div style="display:flex;gap:2px;margin-right:12px;">
          <button class="filter-btn${teamScope === 'project' ? ' active' : ''}" onclick="teamScope='project';delete loaded['team'];loadTeam();" style="padding:6px 14px;font-size:12px;">Project</button>
          <button class="filter-btn${teamScope === 'global' ? ' active' : ''}" onclick="teamScope='global';delete loaded['team'];loadTeam();" style="padding:6px 14px;font-size:12px;">Global</button>
        </div>
        <span class="team-refresh-time" id="team-refresh-indicator"></span>
        <button class="team-refresh-btn" onclick="loadTeam()">
          <span class="iconify" data-icon="lucide:refresh-cw" style="font-size:14px;"></span>
          Refresh
        </button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card" data-accent="cyan">
        <div class="team-stat-icon"><span class="iconify" data-icon="lucide:bot"></span></div>
        <div class="stat-label">${t('teamActiveAgents')}</div>
        <div class="stat-value">${data.activeCount}<span style="font-size:14px;color:var(--text-muted);font-weight:400;"> / ${totalAgents}</span></div>
      </div>
      <div class="stat-card" data-accent="amber">
        <div class="team-stat-icon"><span class="iconify" data-icon="lucide:lock"></span></div>
        <div class="stat-label">${t('teamLockedFiles')}</div>
        <div class="stat-value">${data.locks.length}</div>
      </div>
      <div class="stat-card" data-accent="purple">
        <div class="team-stat-icon"><span class="iconify" data-icon="lucide:list-checks"></span></div>
        <div class="stat-label">${t('teamTasks')}</div>
        <div class="stat-value">${data.tasks.length}</div>
        <div class="team-stat-sub">${tasksByStatus.pending} pending · ${tasksByStatus.in_progress} active · ${tasksByStatus.completed} done</div>
      </div>
      <div class="stat-card" data-accent="green">
        <div class="team-stat-icon"><span class="iconify" data-icon="lucide:mail"></span></div>
        <div class="stat-label">Messages</div>
        <div class="stat-value">${totalUnread}</div>
        <div class="team-stat-sub">${totalUnread > 0 ? totalUnread + ' unread' : 'All read'}</div>
      </div>
    </div>

    <div class="team-grid">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">${t('teamAgents')}</span>
          <span class="team-panel-count">${data.activeCount} active${inactiveAgents > 0 ? ', ' + inactiveAgents + ' offline' : ''}</span>
        </div>
        <div class="panel-body team-scrollable">
          ${data.agents.length === 0
            ? '<div class="team-empty"><span class="team-empty-icon"><span class="iconify" data-icon="lucide:user-x"></span></span><span class="team-empty-text">No agents in ' + (teamScope === 'project' ? 'this session' : 'any scope') + '</span>' + (teamScope === 'project' && data._meta && data._meta.persistedAgents > 0 ? '<div style="font-size:11px;color:var(--accent-amber);margin-top:6px;">' + data._meta.persistedAgents + ' persisted agent(s) available in <a href="#" onclick="teamScope=\'global\';delete loaded[\'team\'];loadTeam();return false;" style="color:var(--accent-purple);text-decoration:underline;">Global view</a></div>' : '') + '</div>'
            : data.agents.map(a => `
              <div class="team-agent-row${a.status !== 'active' ? ' inactive' : ''}">
                <div class="team-agent-status ${a.status === 'active' ? 'active' : 'offline'}"></div>
                <div class="team-agent-info">
                  <div class="team-agent-name">${escapeHtml(a.name)} <span style="font-size:9px;padding:1px 5px;border-radius:4px;font-weight:500;margin-left:4px;${a.source === 'persisted' ? 'background:rgba(255,171,64,0.12);color:var(--accent-amber);' : 'background:rgba(105,240,174,0.12);color:var(--accent-green);'}">${a.source === 'persisted' ? 'file' : 'live'}</span></div>
                  <div class="team-agent-meta">
                    <span>${a.role ? escapeHtml(a.role) : 'no role'}</span>
                    ${a.capabilities && a.capabilities.length ? a.capabilities.map(c => '<span class="team-cap-tag">' + escapeHtml(c) + '</span>').join('') : ''}
                  </div>
                  <div class="team-agent-time">joined ${teamTimeAgo(a.joinedAt)} · seen ${teamTimeAgo(a.lastSeenAt)}${a.leftAt ? ' · left ' + teamTimeAgo(a.leftAt) : ''}</div>
                </div>
                ${a.unread > 0 ? '<span class="team-unread-badge">' + a.unread + '</span>' : ''}
                <span class="team-agent-id">${a.id.slice(0, 8)}</span>
              </div>
            `).join('')
          }
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">${t('teamLocks')}</span>
          <span class="team-panel-count">${data.locks.length} active</span>
        </div>
        <div class="panel-body team-scrollable">
          ${data.locks.length === 0
            ? '<div class="team-empty"><span class="team-empty-icon"><span class="iconify" data-icon="lucide:lock-open"></span></span><span class="team-empty-text">No files locked</span></div>'
            : data.locks.map(l => {
                const owner = data.agents.find(a => a.id === l.lockedBy);
                const ttl = teamLockTTL(l.expiresAt);
                return '<div class="team-lock-row">' +
                  '<div class="team-lock-icon"><span class="iconify" data-icon="lucide:file-lock-2"></span></div>' +
                  '<div class="team-lock-info">' +
                    '<div class="team-lock-file">' + escapeHtml(l.file) + '</div>' +
                    '<div class="team-lock-meta">' +
                      '<span>' + (owner ? escapeHtml(owner.name) : l.lockedBy.slice(0, 8)) + '</span>' +
                      '<span>' + teamTimeAgo(l.lockedAt) + '</span>' +
                      (ttl ? '<span class="team-lock-ttl">' + ttl + '</span>' : '') +
                    '</div>' +
                  '</div>' +
                '</div>';
              }).join('')
          }
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">${t('teamTaskBoard')}</span>
        <span class="team-panel-count">${data.availableTasks} available to claim</span>
      </div>
      <div class="panel-body">
        ${data.tasks.length === 0
          ? '<div class="team-empty"><span class="team-empty-icon"><span class="iconify" data-icon="lucide:clipboard-list"></span></span><span class="team-empty-text">No tasks created</span></div>'
          : '<table class="team-task-table"><thead><tr><th>Status</th><th>ID</th><th>Description</th><th>Assignee</th><th>Deps</th><th>Updated</th></tr></thead><tbody>' +
            data.tasks.map(tk => {
              const assignee = tk.assignee ? (data.agents.find(a => a.id === tk.assignee)?.name || tk.assignee.slice(0, 8)) : '<span style="color:var(--text-muted);">—</span>';
              return '<tr>' +
                '<td><span class="team-task-status" data-status="' + tk.status + '"><span class="iconify" data-icon="' + (statusIcons[tk.status] || 'lucide:circle') + '" style="font-size:13px;"></span> ' + (statusLabels[tk.status] || tk.status) + '</span></td>' +
                '<td><span class="team-task-id">' + tk.id.slice(0, 8) + '</span></td>' +
                '<td>' + escapeHtml(tk.description) + (tk.result ? '<div class="team-task-result"><span class="iconify" data-icon="lucide:corner-down-right" style="font-size:11px;"></span> ' + escapeHtml(tk.result.slice(0, 80)) + '</div>' : '') + '</td>' +
                '<td style="font-size:12px;">' + assignee + '</td>' +
                '<td style="text-align:center;color:var(--text-muted);">' + (tk.deps.length > 0 ? tk.deps.length : '—') + '</td>' +
                '<td style="font-size:11px;color:var(--text-muted);">' + teamTimeAgo(tk.updatedAt) + '</td>' +
              '</tr>';
            }).join('') +
            '</tbody></table>'
        }
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Show last refresh time
  const indicator = document.getElementById('team-refresh-indicator');
  if (indicator) indicator.textContent = new Date().toLocaleTimeString();

  // Auto-refresh every 5 seconds while Team page is active
  if (teamRefreshTimer) clearInterval(teamRefreshTimer);
  teamRefreshTimer = setInterval(() => {
    if (currentPage === 'team') loadTeam();
    else { clearInterval(teamRefreshTimer); teamRefreshTimer = null; }
  }, 5000);
}

// ============================================================
// Init
// ============================================================

// Apply initial language to nav tooltips
setLang(currentLang);

loadPage('dashboard');
