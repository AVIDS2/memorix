# Memorix 已知问题 & 未来路线图

> 最后更新: 2026-07-26 (v1.2.4)

---

## 已知问题 & 限制

### 🔴 严重

| # | 问题 | 影响 | 状态 |
|---|------|------|------|
| 1 | ~~**无文件锁**~~ — 多 Agent 同时写入 | 数据完整性 | ✅ v0.7.11 (`withFileLock` + `atomicWriteFile`) |
| 2 | **Orama where 过滤不可靠** — 空 term + number filter 时结果可能不正确 | `compactDetail` 已绕过 (使用内存查找) | 已变通 |

### 🟡 中等

| # | 问题 | 影响 | 状态 |
|---|------|------|------|
| 3 | **非 Git 项目的 projectId 不稳定** — 基于目录名，不同机器或路径会不同 | 数据隔离 | 未修复 |
| 4 | ~~**retention 只有报告没有执行**~~ | 数据膨胀 | ✅ v0.7.11 (`archiveExpired` + `action="archive"`) |
| 5 | ~~**实体抽取不支持中文标识符**~~ | 中文项目覆盖不足 | ✅ v0.7.11 (中文括号/反引号 + 因果语言) |
| 6 | ~~**auto-relations 每次读取全图**~~ | 性能 | ✅ v0.7.11 (entityIndex O(1) 查找) |
| 7 | **高重要性 observations 永远免疫** — gotcha/decision/trade-off 永不过期 | 数据膨胀 | 设计如此，需评估 |

### 🟢 轻微

| # | 问题 | 影响 | 状态 |
|---|------|------|------|
| 8 | ~~**Kiro/Trae Agent hooks 未实现**~~ | 功能缺失 | ✅ v0.9.12+ (Kiro/Trae/OpenCode/Gemini CLI 全部支持) |
| 9 | **fastembed 首次使用需下载模型** — ~30MB，可能在网络不好时超时 | 用户体验 | 需用户显式安装 (v1.1.5 起默认不再安装 fastembed，因其依赖存在漏洞的 `tar`) |
| 10 | **npx 缓存可能损坏** — 见 `MODULE_NOT_FOUND chownr` 问题 | 安装体验 | 需文档说明 |
| 11 | **Gemini CLI / Antigravity 共享 `.gemini/*` 生态** — hook 运行时身份可能表现为 "last installer wins" | 集成隔离 | 官方设计如此 (v1.0.5) |
| 12 | **Knowledge Base / Knowledge Graph 为只读生成投影** — 暂不支持图编辑 / GraphRAG | 功能范围 | 设计如此 (v1.0.9) |

---

## 未来路线图

### Phase 1: 稳定化 ✅
- [x] Copilot Adapter 实现
- [x] Antigravity Adapter 实现
- [x] MCP Server 集成验证
- [x] 753 测试通过 (v1.0.0)
- [x] 开发文档编写
- [x] README 优化 (中英双语, Antigravity 配置指南)
- [x] npm 发布配置优化

### Phase 2: 推广 & 用户获取
- [ ] 社区推广 (Reddit, HN, X, Discord)
- [ ] 技术博客文章
- [ ] 演示视频
- [ ] 与其他 MCP Server 项目的对比文档

### Phase 3: Web Dashboard ✅
- [x] 知识图谱可视化 (D3.js force graph)
- [x] Observation 搜索/浏览 Web UI
- [x] 记忆保留状态仪表板
- [x] 跨项目记忆概览 (project switcher)

### Phase 4: 功能增强 ✅
- [x] 自动归档过期记忆 (`memorix_retention action="archive"`)
- [x] 文件锁机制 (多进程安全)
- [x] 搜索精确度优化 (fuzzy + field boosting)
- [x] 中文实体抽取
- [x] 图谱-记忆双向同步
- [x] `memorix_transfer` — 导出/导入记忆 (JSON + Markdown)
- [x] 记忆去重和冲突检测 (`memorix_deduplicate` + `memorix_consolidate`)
- [x] LLM 增强模式 (压缩/重排序/写入时去重)

### Phase 5: Agent 集成 ✅
- [x] Kiro 完整支持
- [x] Trae 支持
- [x] OpenCode 支持
- [x] Gemini CLI 支持
- [x] Copilot hooks 支持
- [x] 14+ 个 Agent 全覆盖 (Cursor, Windsurf, Claude Code, Codex, Copilot, Kiro, Antigravity, OpenCode, Trae, Gemini CLI, Pi, OpenClaw, Hermes, Oh-my-Pi 等)

### Phase 6: v1.0.0 特性 ✅
- [x] 团队协作 (Agent注册/文件锁/任务板/消息)
- [x] 工具合并 (41 → 22 默认)
- [x] 启动自动清理 (归档 + LLM/Jaccard 去重)
- [x] Mini-Skills (永久技能, 自动注入)
- [x] 会话管理 (跨会话上下文注入)
- [x] 2064+ 测试通过 (156 files, v1.0.8)

### Phase 7: 记忆形成 & 多维度记忆 (v1.0.1–v1.2.4) ✅
- [x] **Memory Formation Pipeline** — 三阶段管道 (Extract → Resolve → Evaluate) (v1.0.3)
- [x] **Git Memory** — `git commit` 直接流入记忆 (`memorix git-hook` + `ingest commit`) (v1.0.4)
- [x] **Reasoning Memory** — `memorix_store_reasoning` / `memorix_search_reasoning` (v1.0.4)
- [x] **Memory Provenance & 分层披露 (L1/L2/L3)** — `sourceDetail` / `valueCategory` + citation-lite (v1.0.6)
- [x] **Gemini CLI 一等公民集成** (v1.0.5)
- [x] **Programmatic SDK** (`memorix/sdk` + `createMemoryClient`) (v1.0.8)
- [x] **官方 Docker 部署** (HTTP control-plane image + `compose.yaml`) (v1.0.8)
- [x] **SQLite 规范存储** (observations / mini-skills / sessions / archives) (v1.0.8)
- [x] **多 Agent 编排器** `memorix orchestrate` (plan → parallel → verify → fix → review → merge) (v1.0.8)
- [x] **Knowledge Base / LLM Wiki + Knowledge Graph 投影** + TUI Knowledge Workbench (v1.0.9)
- [x] **原生 memcode Agent** (`memorix memcode` 原生编码代理) (v1.0.11)
- [x] **官方 Agent 集成包** — `memorix setup` 一命令安装 12+ agents + 7 官方 skills (v1.1.0)
- [x] **CodeGraph Memory MVP** — SQLite 代码结构层 (files/symbols/import edges/code refs) + Lite provider (v1.1.3)
- [x] **Memory Autopilot** — `memorix context` / `memorix_project_context` 任务透镜的 bounded Workset (v1.1.5–v1.1.8)
- [x] **Agent 集成 doctor / repair** (`memorix doctor agents` + `repair agents`) (v1.1.8)
- [x] **持久化运行时维护** — SQLite maintenance ledger (隔离 runner, dedupe/lease/heartbeat/retry) (v1.1.11)
- [x] **Multidimensional Memory + Code State 版本化 + Knowledge Workspace** (claim ledger, workflows, bounded Worksets) (v1.2.0)
- [x] **Memory control plane / 终端控制面** — 统一 CLI、显式本地身份、可见性 reader (v1.2.1–v1.2.4)
- [x] **Session visibility & continuation context** — `memorix resume`、continuation 一口交付、可见性隔离 (v1.2.3–v1.2.4)

### Phase 8: 未来路线图
- [ ] 多项目记忆关联搜索
- [ ] LLM-based 实体抽取 (替代正则)
- [ ] JetBrains AI 支持
- [ ] VS Code + Continue.dev 支持
- [ ] 自定义 embedding 模型支持
- [ ] 记忆联邦协议 (跨团队共享)
- [ ] 外部语义 CodeGraph provider 成熟化 (超越内置 Lite)
- [ ] Knowledge Graph 可编辑 / GraphRAG

---

## 依赖关系

### 运行时依赖
| 包 | 版本 | 用途 |
|---|------|------|
| `@modelcontextprotocol/sdk` | ^latest | MCP 协议 SDK |
| `@orama/orama` | ^latest | 全文/向量搜索 |
| `gpt-tokenizer` | ^latest | Token 计数 |
| `citty` | ^latest | CLI 框架 |
| `@clack/prompts` | ^latest | CLI 交互提示 |
| `zod` | ^3 | 参数验证 |

### 可选依赖
| 包 | 版本 | 用途 |
|---|------|------|
| `fastembed` | ^latest | 本地 ONNX embedding (384d)，需用户显式安装 |

### 开发依赖
| 包 | 版本 | 用途 |
|---|------|------|
| `vitest` | ^latest | 测试框架 |
| `tsup` | ^latest | 打包构建 |
| `typescript` | ^5 | 类型系统 |

---

## 技术债务

| 优先级 | 项目 | 说明 |
|--------|------|------|
| ~~P0~~ | ~~文件锁~~ | ~~✅ v0.7.11~~ |
| ~~P1~~ | ~~自动归档~~ | ~~✅ v0.7.11~~ |
| P1 | projectId 稳定性 | 非 Git 项目需要更好的识别策略 |
| ~~P2~~ | ~~中文实体抽取~~ | ~~✅ v0.7.11~~ |
| ~~P2~~ | ~~auto-relations 性能~~ | ~~✅ v0.7.11~~ |
| P3 | Orama 持久化 | 考虑 Orama 的原生持久化而非每次重建 (部分缓解: v1.0.8 SQLite 成为规范存储) |
| ~~P3~~ | ~~observations.json 性能~~ | ~~✅ v1.0.8 迁移至 SQLite (#52)~~ |
| ~~P3~~ | ~~测试覆盖~~ | ~~✅ 2064 tests, 156 files (v1.0.8)~~ |

---

## 历史重要事件

| 日期 | 事件 |
|------|------|
| 2026-02-13 | Copilot Adapter 实现完成，274 测试全部通过 |
| 2026-02-13 | Antigravity MCP 配置修复，Memorix MCP Server 首次成功运行 |
| 2026-02-13 | 发现并修复 npx 缓存损坏问题 (MODULE_NOT_FOUND chownr) |
| 2026-02-15 | 完成全部核心模块的深度代码审查 |
| 2026-02-15 | 开发文档完成 (ARCHITECTURE, MODULES, DEVELOPMENT, DESIGN_DECISIONS, API_REFERENCE) |
| 2026-02-24 | v0.7.8-0.7.10: Antigravity 兼容 + MCP roots + 中英双语文档 |
| 2026-02-24 | v0.7.11: P0-P2 全部完成 (文件锁 + 搜索优化 + 自动归档 + 中文实体 + 性能优化 + 图谱同步) |
| 2026-02-25 | v0.9.0-0.9.12: Hooks 系统全量修复 + 10 Agent 支持 |
| 2026-02-28 | v0.9.25: Windsurf 兼容性修复 |
| 2026-03-05 | v0.10.5: Antigravity/Claude Code hooks 修复 |
| 2026-03-07 | v0.11.0: Mini-Skills + LLM 增强模式 |
| 2026-03-09 | **v1.0.0**: 首个稳定版 — 22 工具 + 团队协作 + 自动清理 + 753 测试 |
| 2026-03-14 | v1.0.3: Memory Formation Pipeline (Extract→Resolve→Evaluate) |
| 2026-03-17 | v1.0.4: Git Memory + Reasoning Memory + 结构化配置 (`memorix.yml`) |
| 2026-04-05 | v1.0.6: Memory Provenance + 分层披露 (L1/L2/L3) + citation-lite |
| 2026-04-19 | v1.0.8: Programmatic SDK + Docker + SQLite 规范存储 + 多 Agent 编排器 (2064 测试) |
| 2026-05-19 | v1.0.9: Knowledge Base / LLM Wiki + Knowledge Graph + TUI Workbench |
| 2026-06-13 | v1.0.11: 原生 memcode 编码代理 |
| 2026-06-21 | v1.1.0: 官方 Agent 集成包 — `memorix setup` 一命令安装 12+ agents |
| 2026-06-29 | v1.1.3: CodeGraph Memory MVP |
| 2026-07-08 | v1.1.5–v1.1.8: Memory Autopilot + Agent 集成 doctor/repair |
| 2026-07-16 | v1.1.11: 持久化运行时维护 (SQLite maintenance ledger) |
| 2026-07-18 | v1.2.0: Multidimensional Memory + Code State 版本化 + Knowledge Workspace |
| 2026-07-26 | **v1.2.4**: Memory control plane + session visibility + continuation context (`memorix resume`) |
