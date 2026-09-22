# Memorix 已知边界与路线图

> 最后审阅：2026-09-22（对照已发布 v1.9.5 与当前 1.9.x 收口工作树）

这份文档说明仍然成立的产品边界、风险和方向；它不是发布流水账。

- 已发布版本和每次修复的事实，以 [CHANGELOG](../CHANGELOG.md) 为准。
- 当前正在进行的维护工作，以 [ACTIVE_WORK](../ACTIVE_WORK.md) 为准。
- 可讨论、可订阅的后续事项，以 GitHub Open Issues 为准。

---

## 1.9.x 基础设施收口（当前工作树，未发布）

> 本节记录本轮基础设施整改的实现与验收边界。版本号仍保持在 1.9.x，
> 不把未发布的工作树改写成新的发布版本。

### 已完成并通过回归

- SQLite 数据库句柄采用 lease + 有上限的 LRU registry；HTTP session 有硬上限、
  pending admission、过期回收和关闭释放；health 暴露 SQLite、session、runtime
  与 event-loop 指标。
- MCP modern bridge 按请求创建协议 server，按项目复用有界 business runtime；
  legacy business store 入口有串行门，避免跨项目并发切换污染。
- Task Continuity 采用 `requirement -> verification -> evidence -> outcome` 的
  可更新验证项语义，支持 `validated-with-risks`、幂等键、状态替换和 immediate
  transaction 上限保护。
- Orchestrator 记录脱敏的 effect ledger 与结构化 trace，标记成功、失败、未知和
  重放要求；Memory Quality Gate 覆盖命中、精度、隔离、过期拒绝、延迟、RSS、
  token 预算和失败归因。
- `npm run lint`、`npm run build`、`npm run gate:memory-quality`、全量 Vitest
  与现代 MCP/HTTP 集成回归均通过；本轮没有待处理的发布阻塞缺口。

### 明确保留的产品边界

- SQLite 底层仍是同步 API；本轮通过 runtime 串行门、资源上限、event-loop 指标和
  quality gate 控制风险，没有虚假宣称已经异步化。
- 协议层 modern MCP 保持 stateless；官方 SDK 的每请求 server 生命周期与业务
  runtime 复用是两个不同层次，Durable Tasks 仍按既有契约不支持。
- Memory Quality Gate 是确定性本地基准和回归门，不把一次通过误报成所有模型、
  所有项目规模下的检索质量保证。

---

## 1.9.5 发布结论与剩余后续项

> `v1.9.5` 已发布，版本标签为 `658231f`；1.9.x 容量维护已通过 #306
> 合入当前主线 `3a3dd49`。本节保留发布证据和仍有外部依赖的事项，不再把
> 已完成的门槛伪装成未完成工作。

### 发布门槛

| 优先级 | 项目 | 当前结论 | 1.9.5 完成标准 |
|---|---|---|---|
| P1 | HTTP 控制面安全与生命周期 | 已完成并随 v1.9.5 发布。 | 回环默认、非回环显式安全策略、请求体上限、监听失败、后台清理、HTTP/SQLite 关闭和真实 smoke 均通过。 |
| P1 | 项目隔离 | 已完成并随 v1.9.5 发布。 | 图谱实体/边按项目存储，Dashboard/MCP 查询、替换、删除和旧 JSONL 迁移测试通过。 |
| P1 | 迁移失败语义 | 已完成并随 v1.9.5 发布。 | legacy observations/subdirectories 具备锁和原子写入；坏 JSON fail-closed，不伪装成空库。 |
| P1 | Store / SQLite 生命周期 | 已完成；本轮容量切片补齐了缓存、查询和维护保留边界，没有已知发布阻塞。 | SDK 同目录引用计数、sync ID/tombstone、活锁保护、关闭路径、多实例与容量回归通过。 |
| P2 | 内存与容量边界 | 已完成并通过 #306 合入主线；压力验证也纳入本轮回归。 | TeamStore SQL 查询上限、failed job 30 天保留、三类 embedding cache 字节预算、HTTP project/store cache 驱逐均已有代码和回归覆盖。 |
| P1 | 发布契约 | 已完成并随 v1.9.5 发布。 | tag/version/commit 校验、npm 传播等待、check-only prepublish、npm 和 MCP Registry 发布均已验证。 |

### 新 issue / PR 处置

- [#301](https://github.com/AVIDS2/memorix/issues/301) / [#303](https://github.com/AVIDS2/memorix/pull/303)：已通过 #305 合并并随 v1.9.5 发布；原 PR 已标记为 superseded。
- [#302](https://github.com/AVIDS2/memorix/issues/302) / [#304](https://github.com/AVIDS2/memorix/pull/304)：已通过 #305 合并并随 v1.9.5 发布；原 PR 已标记为 superseded。
- [#300](https://github.com/AVIDS2/memorix/pull/300)：Atlas Cloud 是可选 provider；当前收口分支补齐了配置隔离和完整 CI，确认后合入 1.9.x，不改变默认 provider。
- [#297](https://github.com/AVIDS2/memorix/issues/297)：外部 awesome-list 收录请求，需按对方仓库的贡献流程处理，不是 Memorix 代码阻塞。
- [#283](https://github.com/AVIDS2/memorix/issues/283)：已完成文档收口；OrcaRouter 通过现有 OpenAI-compatible `base_url` 配置使用，不需要新 provider 枚举。
- [#49](https://github.com/AVIDS2/memorix/issues/49) 与 [#3](https://github.com/AVIDS2/memorix/issues/3)：外部集成提案；当前没有可验证的宿主身份/Hook 契约，不纳入本轮维护代码。

---

## 当前产品边界

Memorix 是本地优先、可插拔的 Agent Memory 系统。它给不同 Agent 或同一 Agent 的新会话提供同一个项目记忆层，并把 CLI 作为最完整、最稳定的控制面；MCP 是面向 Agent 的受控入口，而不是唯一入口。

当前版本已经包括：

- 项目记忆、会话续接、任务透镜和按需展开的上下文；
- 代码状态、知识库 / Wiki、知识图谱投影和工作流记录；
- 受控的本地媒体资产库，可显式导入图片、音频、视频和 PDF，并保留来源、哈希、配额和删除审计；
- 多 Agent 集成、hook、doctor / repair，以及可选择的后台维护；
- SQLite 规范存储、可见性边界、保留策略和清理审计。

这些能力并不等于“任何数据都会被自动收集”或“所有媒体都已经被模型理解”。Memorix 的默认边界是显式、可追溯、可清理，避免把无关聊天、任意本地文件或有成本的模型调用悄悄写入长期记忆。

---

## 仍需注意的边界

| 主题 | 现状 | 使用建议 |
|---|---|---|
| 项目绑定 | 没有可靠工作区根目录时，MCP 会等待显式根目录、MCP Roots 或会话启动，而不会猜测上一个项目。 | 这是防止跨项目读写的安全边界；首次接入时按客户端的项目根目录配置即可。 |
| 向量与外部模型 | 可选嵌入提供商、网络和首次模型准备会影响写入或检索延迟。 | 不要把外部 API 的瞬时可用性当作本地数据是否已写入的唯一判断；先用 `memorix status` / `doctor` 看状态。 |
| 媒体记忆 | 已有受控附件和元数据/向量基础，PDF 文本提取与音频转写是显式的受控派生链路；视频语义提取仍不是默认的全自动链路。 | 只导入确实需要长期复用的资产；不要把截图或工具输出当作默认记忆来源。 |
| 图谱与 Wiki | 它们是从规范记忆和代码状态生成的可追溯投影，不是可任意编辑的 GraphRAG 数据库。 | 先写清楚有来源的知识和决策，让投影自然形成关联；不要把图谱当作另一份手工真相。 |
| Agent 集成 | 上游客户端会改变 hook、MCP、配置文件和权限模型。 | 使用 `memorix doctor agents` 诊断，优先让 `setup` / `repair` 做非破坏性修复。 |
| 大规模数据 | 保留、归档、去重和检索预算已存在，但上万至百万级数据仍需要按项目负载做容量验证。 | 为高增长项目配置明确的保留与清理策略，并关注 Dashboard / CLI 的审计信息。 |

---

## 公开路线

### 1. 稳定性与可操作性

- 继续以 Windows、macOS/Linux、CLI、MCP、后台服务和全新安装作为发布门槛；
- 保持 MCP 工具面小而按需展开，CLI 保持完整的管理和恢复能力；
- 让配置迁移、诊断、修复和清理保持非破坏性、可解释、可回退。

### 2. 记忆质量与知识工作区

- 提高“新会话接手”时的相关性：先给简短进度卡，再按任务取详情；
- 统一保留状态、归档、检索预算和 Dashboard 的解释，避免同一条记忆在不同入口显示不同状态；
- 继续发展代码状态、知识库、Wiki、图谱和工作流之间的可追溯关联，而不是重复堆叠文本摘要。

### 3. 受控的多模态派生能力

- 继续在现有资产生命周期之上评估视频语义派生，保持与 PDF/音频派生相同的来源、成本边界、配额、删除联动和重建路径；
- 每一类派生都必须有来源、成本边界、配额、删除联动和重建路径；
- 不把“接受任意 URL / 任意文件”误宣传为完整多模态 RAG。

### 4. Agent 生态与研究

- 跟进受用户需求推动的集成，例如 [Qwen 自动 hooks](https://github.com/AVIDS2/memorix/issues/3) 与 [持久化 Agent 身份](https://github.com/AVIDS2/memorix/issues/49)；
- 独立推进记忆能力的实证研究，例如[模型能力如何改变项目记忆收益与伤害边界](https://github.com/AVIDS2/memorix/issues/152)，不把研究假设当作产品已经证明的效果。
- DeepSeek Harness 支持已随 `memorix setup --agent dsh` 发布：写入 MCP 行（`$DSH_HOME/cordis.patch.yml`，默认 `~/.dsh/cordis.patch.yml`）、AGENTS.md 使用规范与官方 skills；工具以 `mcp__memorix__*` 形式出现。

---

## 贡献与验证原则

贡献会先检查三件事：是否符合当前存储/可见性/生命周期边界，是否能由 CLI 与 MCP 一致地使用，是否有可重复的测试或人工验证证据。功能方向有价值但架构已演进的 PR 会保留作者署名，并通过公开后续 Issue 延续，而不是悄悄重写或吞掉成果。

历史版本、已解决问题和详细发布日期请查看 [CHANGELOG](../CHANGELOG.md)。
