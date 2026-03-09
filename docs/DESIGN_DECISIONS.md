# Memorix 设计决策记录

> 最后更新: 2026-03-09 (v1.0.0)
> 记录所有重要的架构和设计决策及其背后的理由

---

## 决策编号规则
- `ADR-XXX`: Architecture Decision Record (架构决策)
- 按时间顺序编号

---

## ADR-001: 采用 MCP Protocol 而非自定义协议

**状态**: 已采纳

**背景**: 需要让 Memorix 与多种 AI Agent (Cursor, Windsurf, Claude Code 等) 通信。

**决策**: 使用 MCP (Model Context Protocol) 作为通信协议。

**理由**:
- MCP 是 Anthropic 制定的开放标准，被多数 AI IDE 支持
- stdio 传输模式简单可靠，无需 HTTP 服务器
- 已有 `@modelcontextprotocol/sdk` 官方 SDK
- 兼容 MCP Official Memory Server 的工具命名

**影响**:
- 日志必须输出到 `stderr` (stdout 被 MCP 协议占用)
- 工具必须返回 `{ content: [{ type: 'text', text: ... }] }` 格式
- 不能主动推送消息给 Agent，只能响应工具调用

---

## ADR-002: 双存储模型 (Knowledge Graph + Observations)

**状态**: 已采纳

**背景**: MCP Official Memory Server 只有知识图谱，表达能力有限。

**决策**: 采用双存储：
- Knowledge Graph (MCP 兼容): Entity + Relation
- Structured Observations (claude-mem 启发): 带类型、事实、概念的丰富记录

**理由**:
- Knowledge Graph 适合存储实体关系 (who/what)
- Observations 适合存储事件和上下文 (when/why/how)
- 两者通过 `entityName` 关联
- 保持与 MCP Official Memory Server 工具 API 100% 兼容

**权衡**:
- 增加了存储复杂度
- 需要两套持久化机制 (JSONL vs JSON)
- observation 的 entity 引用可能与图谱不同步

---

## ADR-003: 3层渐进式披露

**状态**: 已采纳

**背景**: AI Agent 的上下文窗口有限，全量返回记忆会浪费 token。

**决策**: 采用 claude-mem 的 3层渐进式披露：
- L1 Search: 紧凑索引 (~50-100 tokens/条)
- L2 Timeline: 时间线上下文
- L3 Detail: 完整详情 (~500-1000 tokens/条)

**理由**:
- claude-mem 验证了此模式的有效性 (27K stars, ~10x token 节省)
- Agent 可以先浏览索引，再按需获取详情
- Token 预算管理让 Agent 控制成本

**影响**:
- 需要 3 个 MCP 工具而非 1 个搜索工具
- Agent 需要学习使用 Progressive Disclosure 工作流
- 在工具描述中嵌入了 Progressive Disclosure 使用提示

---

## ADR-004: Orama 作为搜索引擎

**状态**: 已采纳

**背景**: 需要全文搜索和向量搜索能力。

**考虑的方案**:
| 方案 | 优点 | 缺点 |
|------|------|------|
| SQLite FTS5 | 成熟, 持久化 | 无向量搜索, 需要 native addon |
| Orama | 纯 JS, 支持向量, 轻量 | 内存中, 重启需重建 |
| Meilisearch | 功能丰富 | 需要额外进程 |
| pgvector | 强大的向量搜索 | 太重, 需要 PostgreSQL |

**决策**: 采用 Orama。

**理由**:
- 纯 JavaScript, 零 native 依赖
- 内置 BM25 全文搜索
- 支持向量搜索 (可选)
- 可嵌入到进程中, 无需额外服务
- 通过 npx 安装时无编译步骤

**权衡**:
- 内存中运行 — 重启需要重建索引 (`reindexObservations`)
- 大量数据时内存占用可能较高
- Orama 的某些 where 过滤行为不太直观

---

## ADR-005: 全局共享数据目录

**状态**: 已采纳

**背景**: 需要让不同 Agent 共享同一个项目的记忆数据。

**决策**: 数据存储在 `~/.memorix/data/<projectId>/`。

**理由**:
- 所有 Agent 都可以访问同一个目录
- projectId 基于 Git remote URL, 保证同一项目的唯一性
- 不污染项目目录
- 不需要用户额外配置

**权衡**:
- 多个 Agent 同时写入可能冲突 (无文件锁)
- 非 Git 项目的 projectId 可能不稳定 (基于目录名)
- 用户数据不跟随 Git (需要手动备份)

---

## ADR-006: 可选 Embedding (优雅降级)

**状态**: 已采纳

**背景**: 向量搜索显著提升搜索质量，但 fastembed 有 ~30MB 模型下载。

**决策**: Embedding 作为可选功能，不安装时自动降级为纯全文搜索。

**理由**:
- 降低入门门槛 — npx 即用
- 全文搜索 (BM25) 对于大多数场景已足够好
- 需要向量搜索的高级用户可以安装 fastembed
- 避免首次启动时的长时间模型下载

**实现**:
- `getEmbeddingProvider()` 尝试动态 import
- Schema 根据 provider 是否存在动态调整
- 搜索自动选择 fulltext 或 hybrid 模式

---

## ADR-007: Hooks 系统实现隐式记忆

**状态**: 已采纳

**背景**: 依赖 Agent 主动调用 `memorix_store` 不可靠 — Agent 可能忘记存储重要信息。

**决策**: 实现 Hooks 系统，自动从 Agent 的操作中抓取值得记忆的信息。

**架构**: `stdin JSON → Normalizer → Pattern Detector → Handler → Store`

**理由**:
- 不依赖 Agent 的记忆意识
- 通过模式检测过滤噪音，只记录有价值的信息
- 30秒冷却期防止信息过载
- 多 Agent 格式统一化确保跨平台兼容

**权衡**:
- 增加了实现复杂度
- 模式检测可能有误报/漏报
- 不同 Agent 的 Hook 接入方式差异大
- 需要维护每个 Agent 的格式适配

---

## ADR-008: 指数衰减的记忆保留

**状态**: 已采纳

**背景**: 随着时间推移，记忆会越来越多，需要管理过期记忆。

**决策**: 采用指数衰减 + 免疫机制。

**公式**: `score = base × e^(-age/retention) × accessBoost`

**理由**:
- 指数衰减符合人类记忆的遗忘曲线
- 高重要性和高访问频率的记忆自然保留
- 免疫机制保护关键知识不被遗忘
- 三区域分类 (Active/Stale/Archive) 提供清晰的生命周期

**当前限制**:
- 只有报告功能，没有实际的自动归档/删除
- `high` 重要性默认免疫 — 这意味着 gotcha/decision/trade-off 永远存在
- 未来需要添加 `memorix_compact` 工具来实际归档

---

## ADR-009: JSONL 格式存储知识图谱

**状态**: 已采纳

**背景**: MCP Official Memory Server 使用单文件 JSON 存储整个图谱。

**决策**: 使用 JSONL (JSON Lines) 格式分开存储 entities 和 relations。

**理由**:
- 每行一个记录，便于追加写入
- 与 MCP Official Memory Server 的数据模型兼容
- 便于外部工具处理 (grep, jq)
- 文件损坏时只影响单行而非整个文件

**权衡**:
- 读取需要逐行解析
- 不支持原子更新（需要全文重写）
- 与 MCP Official Server 的单文件 JSON 格式不完全相同

---

## ADR-010: 实体自动抽取 (MAGMA 启发)

**状态**: 已采纳

**背景**: 用户提供的概念和文件列表通常不完整。

**决策**: 使用正则表达式从 observation 内容中自动抽取实体。

**理由**:
- 灵感来自 MemCP 的 RegexEntityExtractor (MAGMA 论文)
- 零额外依赖 — 纯正则匹配
- 自动丰富的概念和文件列表提升搜索召回率
- 因果语言检测帮助推断关系类型

**权衡**:
- 正则表达式的准确率有限 (可能误匹配)
- 不支持中文标识符
- 无法理解语义关系 — 只做词汇级别匹配
- 未来可以考虑用 LLM 替代正则做更智能的抽取

---

## ADR-011: 跨 Agent 工作空间同步

**状态**: 已采纳

**背景**: 用户经常在多个 AI IDE 之间切换，每次都要重新配置 MCP servers、规则等。

**决策**: 实现一键式工作空间迁移 — MCP configs + Rules + Workflows + Skills。

**理由**:
- 这是 Memorix 独有的差异化功能
- 减少用户在 Agent 之间切换的摩擦
- 集中管理避免配置不一致
- 支持选择性同步 (`items` 参数)

**实现要点**:
- 每个 Agent 一个 MCP 配置适配器 (parse ↔ generate)
- 每个 Agent 一个规则格式适配器
- Workflow 格式转换
- Skills 目录复制
- Apply 操作带备份和回滚

---

## ADR-012: CLI 使用 Citty 框架

**状态**: 已采纳

**背景**: 需要一个轻量级 CLI 框架来定义命令。

**考虑的方案**: Commander, Yargs, Citty, CAC

**决策**: 使用 Citty (UnJS 生态)。

**理由**:
- 轻量级, 无额外依赖
- TypeScript 原生支持
- 与 UnJS 生态其他工具 (如 Nitro, Nuxt) 一致
- 支持子命令定义
- 自动生成 help 信息

---

## ADR-013: 工具合并 (41 → 22 默认)

**状态**: 已采纳 (v1.0.0)

**背景**: 工具数量膨胀到 41 个，超出多数 IDE 的工具槽位限制。

**决策**: 
- Team 工具: 13 个合并为 4 个 (使用 `action` 参数模式)
- KG 工具: 9 个改为可选 (通过 `~/.memorix/settings.json` 启用)
- Export+Import: 2 个合并为 1 个 `memorix_transfer`

**理由**:
- 多数用户不需要知识图谱工具，默认隐藏减少器噪
- `action` 参数模式是 MCP 工具的最佳实践（减少工具数量，保留功能）
- 22 个默认工具在所有 IDE 工具槽位限制内

---

## ADR-014: 团队协作 (team-state.json)

**状态**: 已采纳 (v1.0.0)

**背景**: 多个 Agent 在同一工作区并行工作时，缺乏协调机制。

**决策**: 基于文件的团队状态共享，包含 4 个工具：注册/文件锁/任务板/消息。

**理由**:
- 文件锁防止多 Agent 同时编辑同一文件
- 任务板让 Agent 之间分工协作
- 消息传递实现跨 IDE 通信
- `team-state.json` 简单可靠，无需额外服务

**生产加固**:
- Inbox 上限 200 条，自动淡化旧消息
- 文件锁 10min TTL 自动释放
- Agent 离开时自动释放所有锁 + 清空 Inbox
- 孤儿任务自动救援

---

## ADR-015: 启动自动清理

**状态**: 已采纳 (v1.0.0)

**背景**: 用户往往忘记手动运行 `memorix_retention` 和 `memorix_consolidate`。

**决策**: 在 `deferredInit` 中自动执行：
1. `archiveExpired()` — 归档过期记忆
2. 有 LLM: `deduplicateMemory()` — 语义去重
3. 无 LLM: `executeConsolidation()` — Jaccard 相似度合并

**理由**:
- 零人工维护，用户无需知道记忆管理细节
- 配置了 LLM 的用户想要更高质量，每次仅消耗几百 token
- 在 MCP 握手后的后台任务中执行，不影响主流程

---

## ADR-016: LLM 增强模式 (可选)

**状态**: 已采纳 (v0.11.0)

**背景**: 纯启发式去重质量有限，LLM 可以提供更智能的记忆管理。

**决策**: 可选 LLM 集成，提供三项能力：
- **叙述压缩**: 存储前压缩冗余内容 (~27% token 节省)
- **搜索重排序**: 按语义相关性重新排序 (60% 查询改善)
- **写入时去重**: 写入时检测重复和冲突

**理由**:
- 所有 LLM 功能均为可选，不配置时默认用启发式引擎
- 智能过滤确保 LLM 仅在有意义时被调用
- 支持 OpenAI/Anthropic/OpenRouter 及任何兼容接口
- 配置优先级: 环境变量 > `~/.memorix/config.json` > 自动检测
