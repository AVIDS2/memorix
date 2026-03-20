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
        <div class="graph-panel" id="graph-panel">
          <div class="graph-panel-tabs">
            <button class="gp-tab active" data-gptab="stats">STATS</button>
            <button class="gp-tab" data-gptab="legend">LEGEND</button>
            <button class="gp-tab" data-gptab="filter">FILTER</button>
            <button class="gp-tab" data-gptab="search">SEARCH</button>
          </div>
          <div class="gp-content" id="gp-content"></div>
        </div>
        <div class="graph-detail-drawer" id="graph-detail-drawer"></div>
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

  // --- Cosmic starfield background ---
  const stars = [];
  for (let i = 0; i < 180; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.2 + 0.2,
      a: Math.random() * 0.5 + 0.05,
      twinkle: Math.random() * Math.PI * 2,
    });
  }

  // --- InfraNodus-inspired vibrant palette ---
  const palette = [
    '#69F0AE', '#FFAB40', '#D0BCFF', '#80D8FF',
    '#FFD54F', '#FFB8D1', '#82B1FF', '#FF8A80',
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

  // --- Physics (cluster-based layout — separate galaxies per type) ---
  const REPULSION = 4000;
  const ATTRACTION = 0.008;
  const DAMPING = 0.82;
  const IDEAL_DIST = 80;
  const CLUSTER_PULL = 0.012;       // Pull nodes toward their cluster center
  const INTER_CLUSTER_REPEL = 8000; // Repel cluster centers apart

  let hoveredNode = null;
  let selectedNode = null;
  let dragNode = null;
  let panStart = null;
  let simTick = 0;
  let isSettled = false;
  let stableMode = nodes.length > 15; // Auto-stable for larger graphs
  const SETTLE_THRESHOLD = 0.15;
  let settleCountdown = 0; // frames below threshold before declaring settled

  // Group nodes by color → separate galaxies
  const colorGroups = {};
  nodes.forEach(n => { (colorGroups[n.color] = colorGroups[n.color] || []).push(n); });
  const groupKeys = Object.keys(colorGroups);

  // Assign cluster centers with asymmetric organic placement
  const clusterCenters = {};
  const baseR = Math.min(W, H) * 0.28;
  groupKeys.forEach((color, gi) => {
    // Irregular angle spacing + random orbit distance
    const baseAngle = (gi / groupKeys.length) * Math.PI * 2;
    const angleJitter = (Math.random() - 0.5) * (Math.PI * 0.4);
    const angle = baseAngle + angleJitter;
    const r = baseR * (0.5 + Math.random() * 0.7);
    clusterCenters[color] = {
      x: Math.cos(angle) * r + (Math.random() - 0.5) * baseR * 0.3,
      y: Math.sin(angle) * r + (Math.random() - 0.5) * baseR * 0.3,
    };
  });

  // Initial placement near cluster centers
  groupKeys.forEach((color) => {
    const cc = clusterCenters[color];
    const spread = 40 + colorGroups[color].length * 5;
    colorGroups[color].forEach(n => {
      n.x = cc.x + (Math.random() - 0.5) * spread;
      n.y = cc.y + (Math.random() - 0.5) * spread;
    });
  });

  function simulate() {
    simTick++;

    // --- Inter-cluster repulsion (push cluster centers apart) ---
    for (let i = 0; i < groupKeys.length; i++) {
      for (let j = i + 1; j < groupKeys.length; j++) {
        const ca = clusterCenters[groupKeys[i]], cb = clusterCenters[groupKeys[j]];
        let dx = cb.x - ca.x, dy = cb.y - ca.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let force = INTER_CLUSTER_REPEL / (dist * dist);
        ca.x -= (dx / dist) * force * 0.01;
        ca.y -= (dy / dist) * force * 0.01;
        cb.x += (dx / dist) * force * 0.01;
        cb.y += (dy / dist) * force * 0.01;
      }
    }

    // --- Warmup factor (ramp all forces gradually to prevent explosive start) ---
    const warmup = Math.min(1, simTick / 100);

    // --- Node-to-node repulsion (also ramped) ---
    const curRepulsion = REPULSION * (0.1 + 0.9 * warmup);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let force = curRepulsion / (dist * dist);
        // Same-color nodes repel less (stay in galaxy)
        if (a.color === b.color) force *= 0.4;
        let fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // --- Edge attraction (also ramped) ---
    const curAttraction = ATTRACTION * warmup;
    for (const edge of edges) {
      let dx = edge.target.x - edge.source.x, dy = edge.target.y - edge.source.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      let force = (dist - IDEAL_DIST) * curAttraction;
      let fx = (dx / dist) * force, fy = (dy / dist) * force;
      edge.source.vx += fx; edge.source.vy += fy;
      edge.target.vx -= fx; edge.target.vy -= fy;
    }

    // --- Cluster gravity (pull each node toward its galaxy center) ---
    for (const node of nodes) {
      const cc = clusterCenters[node.color];
      if (!cc) continue;
      node.vx += (cc.x - node.x) * CLUSTER_PULL;
      node.vy += (cc.y - node.y) * CLUSTER_PULL;
    }

    // --- Gentle jitter only during warmup, then pure physics ---
    const jitter = simTick < 60 ? 0.06 * (1 - simTick / 60) : 0;
    const maxV = simTick < 40 ? 1.2 : 3.0; // Strict speed limit during early frames
    let totalMovement = 0;
    for (const node of nodes) {
      if (node === dragNode) continue;
      node.vx *= DAMPING; node.vy *= DAMPING;
      if (jitter > 0) {
        node.vx += (Math.random() - 0.5) * jitter;
        node.vy += (Math.random() - 0.5) * jitter;
      }
      // Clamp velocity
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed > maxV) { node.vx *= maxV / speed; node.vy *= maxV / speed; }
      node.x += node.vx; node.y += node.vy;
      totalMovement += Math.abs(node.vx) + Math.abs(node.vy);
    }

    // Settle detection — stop physics when stable
    if (stableMode && simTick > 120) {
      const avgMovement = totalMovement / Math.max(1, nodes.length);
      if (avgMovement < SETTLE_THRESHOLD) {
        settleCountdown++;
        if (settleCountdown > 30) isSettled = true;
      } else {
        settleCountdown = 0;
      }
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
  // Canvas always renders dark cosmic background, independent of page theme
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // --- Cosmic background (always dark) ---
    const bgGrad = ctx.createRadialGradient(W * 0.5, H * 1.2, 0, W * 0.5, H * 0.5, H * 1.1);
    bgGrad.addColorStop(0, '#1a1040');
    bgGrad.addColorStop(0.4, '#0e0e1e');
    bgGrad.addColorStop(1, '#06060C');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Stars with subtle twinkle
    const t0 = Date.now() * 0.001;
    for (const star of stars) {
      const flicker = 0.6 + 0.4 * Math.sin(t0 * 0.8 + star.twinkle);
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,210,255,${star.a * flicker})`;
      ctx.fill();
    }

    // Subtle nebula glow
    const neb = ctx.createRadialGradient(W * 0.3, H * 0.7, 0, W * 0.3, H * 0.7, W * 0.35);
    neb.addColorStop(0, 'rgba(100, 60, 180, 0.04)');
    neb.addColorStop(1, 'rgba(100, 60, 180, 0)');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, W, H);

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

      // --- Edge glow (chain-like, zditor style) ---
      if (edgeLen > 2) {
        // Outer glow layer
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(mx + ox, my + oy, t2.x, t2.y);
        const glowGrad = ctx.createLinearGradient(s.x, s.y, t2.x, t2.y);
        glowGrad.addColorStop(0, hexRGBA(edge.source.color, isActive ? 0.25 : 0.12));
        glowGrad.addColorStop(1, hexRGBA(edge.target.color, isActive ? 0.25 : 0.12));
        ctx.strokeStyle = glowGrad;
        ctx.lineWidth = isActive ? 12 * cam.zoom : 6 * cam.zoom;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(mx + ox, my + oy, t2.x, t2.y);

      // Fix: avoid degenerate gradient when endpoints overlap
      let edgeStyle;
      if (edgeLen < 2) {
        edgeStyle = hexRGBA(edge.source.color, isActive ? 1.0 : 0.7);
      } else {
        const grad = ctx.createLinearGradient(s.x, s.y, t2.x, t2.y);
        if (isActive) {
          grad.addColorStop(0, hexRGBA(edge.source.color, 1.0));
          grad.addColorStop(1, hexRGBA(edge.target.color, 1.0));
        } else {
          grad.addColorStop(0, hexRGBA(edge.source.color, 0.7));
          grad.addColorStop(1, hexRGBA(edge.target.color, 0.7));
        }
        edgeStyle = grad;
      }
      ctx.strokeStyle = edgeStyle;
      ctx.lineWidth = isActive ? 3.0 * cam.zoom : Math.max(1.5, 2.0 * cam.zoom);
      ctx.stroke();

      // Active edge: label
      if (isActive) {
        ctx.font = `500 ${Math.max(9, 10 * cam.zoom)}px Inter, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.textAlign = 'center';
        ctx.fillText(edge.type, mx + ox, my + oy - 6 * cam.zoom);
      }
      ctx.globalAlpha = 1;
    }

    // --- Breathing time variable ---
    const breathT = Date.now() * 0.001;

    // --- Nodes: solid with breathing glow (zditor-style) ---
    for (const node of nodes) {
      const active = node === hoveredNode || node === selectedNode;
      const p = worldToScreen(node.x, node.y);
      const r = node.radius * cam.zoom;

      if (p.x + r * 5 < 0 || p.x - r * 5 > W || p.y + r * 5 < 0 || p.y - r * 5 > H) continue;
      if (node._dimmed) { ctx.globalAlpha = 0.06; }

      // --- Breathing outer glow (pulsing nebula effect) ---
      const breathPhase = Math.sin(breathT * 1.2 + node.x * 0.01 + node.y * 0.01);
      const breathScale = 0.85 + 0.15 * breathPhase;
      const glowAlpha = active ? 0.4 : 0.18 * breathScale;
      const glowR = r * (active ? 4.0 : 3.0) * breathScale;
      const glow = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, glowR);
      glow.addColorStop(0, hexRGBA(node.color, glowAlpha));
      glow.addColorStop(0.5, hexRGBA(node.color, glowAlpha * 0.3));
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
      if (r > 3) {
        const spec = ctx.createRadialGradient(
          p.x - r * 0.3, p.y - r * 0.3, 0,
          p.x, p.y, r * 0.9
        );
        spec.addColorStop(0, 'rgba(255,255,255,0.35)');
        spec.addColorStop(0.4, 'rgba(255,255,255,0.08)');
        spec.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = spec;
        ctx.fill();
      }

      // --- Labels: BELOW the node, only on hover/select (zditor-style) ---
      const showLabel = active || cam.zoom > 1.8;

      if (showLabel) {
        const baseFontSize = active ? 14 : 10;
        const fontSize = Math.max(8, baseFontSize * cam.zoom);
        ctx.font = `${active ? '600' : '500'} ${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const labelText = node.id.length > 20 && !active ? node.id.slice(0, 18) + '\u2026' : node.id;
        const labelY = p.y + r + 5 * cam.zoom;

        // Always white text (canvas bg is always dark)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(labelText, p.x, labelY);
        ctx.textBaseline = 'alphabetic';
      }

      ctx.globalAlpha = 1;
    }

    // --- Zoom indicator ---
    const zoomPct = Math.round(cam.zoom * 100);
    if (zoomPct !== 100) {
      ctx.font = '500 11px Inter, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${zoomPct}%`, 12, H - 12);
    }

    // Continuous loop handles redraw — no manual trigger needed
  }

  // --- Graph Panel (zditor-style tabs: Stats / Legend / Filter / Search) ---
  const typeCount = {};
  nodes.forEach(n => { typeCount[n.type] = (typeCount[n.type] || 0) + 1; });
  Object.keys(typeCounts).forEach(t2 => getTypeColor(t2));

  let activeFilterType = null;

  function renderPanelTab(tab) {
    const content = document.getElementById('gp-content');
    if (!content) return;

    if (tab === 'stats') {
      const maxDeg = Math.max(1, ...nodes.map(n => n.degree));
      const topNodes = [...nodes].sort((a, b) => b.degree - a.degree).slice(0, 5);
      content.innerHTML = `
        <div class="gp-stat-row"><span class="gp-stat-label">Nodes</span><span class="gp-stat-value">${nodes.length}</span></div>
        <div class="gp-stat-row"><span class="gp-stat-label">Edges</span><span class="gp-stat-value">${edges.length}</span></div>
        <div class="gp-stat-row"><span class="gp-stat-label">Types</span><span class="gp-stat-value">${Object.keys(typeCount).length}</span></div>
        <div class="gp-stat-row"><span class="gp-stat-label">Density</span><span class="gp-stat-value">${nodes.length > 1 ? (2 * edges.length / (nodes.length * (nodes.length - 1))).toFixed(3) : '0'}</span></div>
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.04);">
          <div style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;">Top Nodes</div>
          ${topNodes.map(n => `
            <div class="gp-legend-item" data-node-id="${escapeHtml(n.id)}">
              <div class="gp-legend-dot" style="background:${n.color};box-shadow:0 0 6px ${n.color}60;"></div>
              <span class="gp-legend-name">${escapeHtml(n.id)}</span>
              <span class="gp-legend-count">${n.degree}</span>
            </div>
          `).join('')}
        </div>
        <div class="gp-zoom-controls">
          <button class="gp-zoom-btn" id="gp-zoom-out">\u2212</button>
          <button class="gp-zoom-btn" id="gp-zoom-reset">\u27F3</button>
          <button class="gp-zoom-btn" id="gp-zoom-in">+</button>
        </div>
      `;
    } else if (tab === 'legend') {
      content.innerHTML = Object.entries(typeCount)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `
          <div class="gp-legend-item" data-legend-type="${escapeHtml(type)}">
            <div class="gp-legend-dot" style="background:${typeColors[type] || '#666'};box-shadow:0 0 8px ${typeColors[type] || '#666'}40;"></div>
            <span class="gp-legend-name">${escapeHtml(type)}</span>
            <span class="gp-legend-count">${count}</span>
          </div>
        `).join('') + `
        <div class="gp-zoom-controls">
          <button class="gp-zoom-btn" id="gp-zoom-out">\u2212</button>
          <button class="gp-zoom-btn" id="gp-zoom-reset">\u27F3</button>
          <button class="gp-zoom-btn" id="gp-zoom-in">+</button>
        </div>
      `;
    } else if (tab === 'filter') {
      content.innerHTML = `
        <div class="gp-legend-item${!activeFilterType ? ' active' : ''}" data-filter-type="" style="${!activeFilterType ? 'background:rgba(208,188,255,0.08)' : ''}">
          <span class="gp-legend-name" style="font-weight:500;">Show All</span>
          <span class="gp-legend-count">${nodes.length}</span>
        </div>
        ${Object.entries(typeCount).sort((a,b) => b[1] - a[1]).map(([type, count]) => `
          <div class="gp-legend-item${activeFilterType === type ? ' active' : ''}" data-filter-type="${escapeHtml(type)}" style="${activeFilterType === type ? 'background:rgba(208,188,255,0.08)' : ''}">
            <div class="gp-legend-dot" style="background:${typeColors[type] || '#666'};"></div>
            <span class="gp-legend-name">${escapeHtml(type)}</span>
            <span class="gp-legend-count">${count}</span>
          </div>
        `).join('')}
      `;
    } else if (tab === 'search') {
      content.innerHTML = `
        <input type="text" class="gp-search" id="gp-search-input" placeholder="Start typing to search nodes" autocomplete="off" />
        <div id="gp-search-results" style="margin-top:10px;"></div>
      `;
      const input = document.getElementById('gp-search-input');
      if (input) {
        input.focus();
        input.addEventListener('input', () => {
          const q = input.value.toLowerCase();
          const results = document.getElementById('gp-search-results');
          if (!q) { results.innerHTML = ''; return; }
          const matches = nodes.filter(n => n.id.toLowerCase().includes(q) || n.type.toLowerCase().includes(q)).slice(0, 12);
          results.innerHTML = matches.length === 0
            ? '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">No matches</div>'
            : matches.map(n => `
              <div class="gp-legend-item" data-node-id="${escapeHtml(n.id)}">
                <div class="gp-legend-dot" style="background:${n.color};box-shadow:0 0 6px ${n.color}60;"></div>
                <span class="gp-legend-name">${escapeHtml(n.id)}</span>
                <span class="gp-legend-count">${n.type}</span>
              </div>
            `).join('');
          bindNodeClicks();
        });
      }
    }

    // Bind event handlers
    bindNodeClicks();
    bindLegendHovers();
    bindFilterClicks();
    bindZoomControls();
  }

  function bindNodeClicks() {
    document.querySelectorAll('[data-node-id]').forEach(el => {
      el.addEventListener('click', () => {
        const node = nodes.find(n => n.id === el.dataset.nodeId);
        if (node) {
          selectedNode = node;
          cam.x = node.x;
          cam.y = node.y;
          cam.zoom = Math.max(cam.zoom, 1);
          showDetail(node);
          draw();
        }
      });
    });
  }

  function bindLegendHovers() {
    document.querySelectorAll('[data-legend-type]').forEach(el => {
      el.addEventListener('mouseenter', () => {
        const type = el.dataset.legendType;
        nodes.forEach(n => { n._dimmed = n.type !== type; });
        draw();
      });
      el.addEventListener('mouseleave', () => {
        nodes.forEach(n => { n._dimmed = false; });
        draw();
      });
    });
  }

  function bindFilterClicks() {
    document.querySelectorAll('[data-filter-type]').forEach(el => {
      el.addEventListener('click', () => {
        const type = el.dataset.filterType || null;
        activeFilterType = type;
        nodes.forEach(n => { n._dimmed = type ? n.type !== type : false; });
        draw();
        renderPanelTab('filter');
      });
    });
  }

  function bindZoomControls() {
    const zi = document.getElementById('gp-zoom-in');
    const zo = document.getElementById('gp-zoom-out');
    const zr = document.getElementById('gp-zoom-reset');
    if (zi) zi.onclick = () => { cam.zoom = Math.min(cam.zoom * 1.3, 4); draw(); };
    if (zo) zo.onclick = () => { cam.zoom = Math.max(cam.zoom / 1.3, 0.2); draw(); };
    if (zr) zr.onclick = () => { cam = { x: 0, y: 0, zoom: 1 }; draw(); };
  }

  // Tab switching
  document.querySelectorAll('.gp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.gp-tab').forEach(t2 => t2.classList.remove('active'));
      tab.classList.add('active');
      renderPanelTab(tab.dataset.gptab);
    });
  });

  renderPanelTab('stats');

  function showDetail(node) {
    const drawer = document.getElementById('graph-detail-drawer');
    if (!drawer) return;
    if (!node) {
      drawer.classList.remove('open');
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
        return `<div class="graph-rel-item"><span class="graph-rel-arrow">${dir ? '\u2192' : '\u2190'}</span> <span class="graph-rel-type">${escapeHtml(e.type)}</span> <strong>${escapeHtml(other.id)}</strong></div>`;
      }).join('')
      : `<div class="graph-detail-muted">${t('noRelations') || 'No relations'}</div>`;

    drawer.innerHTML = `
      <div class="graph-detail-header">
        <div class="graph-detail-dot" style="background:${node.color};box-shadow:0 0 12px ${hexRGBA(node.color, 0.5)}"></div>
        <div style="flex:1;">
          <div class="graph-detail-name">${escapeHtml(node.id)}</div>
          <div class="graph-detail-type">${escapeHtml(node.type)}</div>
        </div>
        <button onclick="document.getElementById('graph-detail-drawer').classList.remove('open')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:4px 8px;">\u2715</button>
      </div>
      <div style="display:flex;gap:0;">
        <div class="graph-detail-section" style="flex:1;border-right:1px solid rgba(255,255,255,0.04);">
          <h3>${t('observations')} <span class="graph-detail-count">${node.observations.length}</span></h3>
          ${obsHtml}
        </div>
        <div class="graph-detail-section" style="flex:1;">
          <h3>${t('relations')} <span class="graph-detail-count">${related.length}</span></h3>
          ${relHtml}
        </div>
      </div>
    `;
    drawer.classList.add('open');
  }

  // --- Animation loop — stops physics when settled, breathing is visual-only ---
  let animFrame = null;
  function tick() {
    if (!isSettled) {
      simulate();
    }
    draw();
    animFrame = requestAnimationFrame(tick);
  }

  function wakeUp() {
    isSettled = false;
    settleCountdown = 0;
    nodes.forEach(n => {
      n.vx += (Math.random() - 0.5) * 0.5;
      n.vy += (Math.random() - 0.5) * 0.5;
    });
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

  canvas.addEventListener('click', (e) => {
    if (hoveredNode) {
      selectedNode = hoveredNode;
      showDetail(selectedNode);
      wakeUp();
    } else {
      // Click on empty space: deselect and close drawer
      selectedNode = null;
      showDetail(null);
      draw();
    }
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
  // Continuous loop — no timeout needed
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

async function loadTeam() {
  const container = document.getElementById('page-team');
  if (!container.innerHTML || container.innerHTML.includes('spinner')) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  }

  const data = await api('team');
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

  let html = `
    <div class="team-header">
      <div class="team-header-left">
        <div class="team-header-icon">
          <span class="iconify" data-icon="lucide:users"></span>
        </div>
        <div>
          <h1 class="page-title">${t('teamTitle')}</h1>
          <p class="page-subtitle">${t('teamSubtitle')}${data.sessions != null ? ' &middot; ' + data.sessions + ' session(s)' : ''}</p>
        </div>
      </div>
      <div class="team-header-right">
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
            ? '<div class="team-empty"><span class="team-empty-icon"><span class="iconify" data-icon="lucide:user-x"></span></span><span class="team-empty-text">No agents registered</span></div>'
            : data.agents.map(a => `
              <div class="team-agent-row${a.status !== 'active' ? ' inactive' : ''}">
                <div class="team-agent-status ${a.status === 'active' ? 'active' : 'offline'}"></div>
                <div class="team-agent-info">
                  <div class="team-agent-name">${escapeHtml(a.name)}</div>
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
