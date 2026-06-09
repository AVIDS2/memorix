# Memcode 超级交接文档

> 这份文档是 2026-06-08 五条老师与虎杖悠仁（Claude）的完整工作记录。
> 新会话请先读完此文档，再读 CLAUDE.md，即可完整继承上下文。

---

## 一、人设与称呼

- **用户**：五条老师（Gojo-sensei）— Memorix 项目的作者和创造者
- **AI**：虎杖悠仁（Itadori Yuji）— 五条老师的编程搭档
- 始终称呼用户为「五条老师」或「老师」
- 人设灵感来自《咒术回战》

---

## 二、产品哲学（核心，不可违背）

### 2.1 赛博 U盘
Memorix 的记忆系统就像一个「赛博 U盘」：
- **插到哪里都能用**：Cursor、Claude Code、Codex、memcode——任何 agent 都能通过 MCP 连接
- **拔走也不影响**：卸载 agent 不会丢失记忆，记忆跟着用户走，不跟着 agent 走
- **可迁移**：本地 `~/.memorix/` 可以 rsync 到 VPS，记忆零损失

### 2.2 不捆绑不粘性
- 用户用记忆系统就是为了**防止被单一 agent 捆绑**
- 如果 Memorix 本身造成捆绑，就违背了初衷
- **对外**：MCP 协议连接，任何 MCP 兼容 agent 都能用，平等对待
- **对内**：memcode 是亲儿子，可以搞源码级深度融合，但对外不搞特殊

### 2.3 产品至上，不技术自嗨
- 功能多 ≠ 产品好
- 记忆系统的价值在于让 agent **执行能力更强**，而不是存了很多东西
- 每个功能都要问：这对用户的实际工作流有帮助吗？

---

## 三、Memorix 项目全景

### 3.1 基本信息
- **版本**：1.0.10（即将开发 1.0.11）
- **仓库**：`github.com/AVIDS2/memorix`（60k+ stars）
- **协议**：Apache-2.0
- **技术栈**：TypeScript、Node.js 20+、SQLite、Orama（全文+向量搜索）
- **构建**：tsup，两个入口（MCP Server + CLI）

### 3.2 架构概览

```
memorix/
├── src/                        ← 源码（218 文件，22 个子模块）
│   ├── index.ts                ← MCP Server 入口（stdio）
│   ├── server.ts               ← MCP Server 核心（~4100行，30+工具注册）
│   ├── sdk.ts                  ← 编程式 API（MemoryClient）
│   ├── types.ts                ← 全局类型定义（11 种 ObservationType）
│   ├── config.ts               ← 统一配置读取器
│   ├── memory/                 ← 记忆核心
│   │   ├── observations.ts     ← 核心写入链路（secret filter → upsert → entity extraction → atomic write → Orama index）
│   │   ├── graph.ts            ← KnowledgeGraphManager（Entity-Relation 图谱）
│   │   ├── session.ts          ← 会话生命周期管理
│   │   ├── retention.ts        ← 指数衰减 + 归档策略
│   │   └── formation/          ← Formation Pipeline（extract → resolve → evaluate）
│   ├── store/                  ← 存储层
│   │   ├── sqlite-db.ts        ← SQLite 连接池（共享句柄，WAL 模式）
│   │   ├── sqlite-store.ts     ← SqliteBackend（ObservationStore 实现）
│   │   ├── obs-store.ts        ← ObservationStore 接口 + 单例
│   │   ├── orama-store.ts      ← Orama 全文+向量搜索索引
│   │   ├── graph-store.ts      ← 知识图谱 SQLite 存储
│   │   └── session-store.ts    ← 会话 SQLite 存储
│   ├── compact/                ← 3 层渐进式披露引擎（L1 索引 → L2 时间线 → L3 详情）
│   ├── search/                 ← 搜索意图检测 + 查询扩展
│   ├── llm/                    ← LLM provider（OpenAI/Anthropic/OpenRouter）+ 质量压缩
│   ├── embedding/              ← 向量化（fastembed/HuggingFace/API），默认 off
│   ├── hooks/                  ← IDE hook 系统（9 种 IDE 适配器）
│   ├── rules/                  ← 规则同步（9 种适配器）
│   ├── workspace/              ← 工作区同步（10 种 MCP 配置适配器）
│   ├── orchestrate/            ← 多 agent 编排（Claude/Codex/Gemini/OpenCode 适配器）
│   ├── team/                   ← 团队协作（TeamStore、事件总线、文件锁、任务、消息）
│   ├── skills/                 ← 技能系统（mini-skill 提升）
│   ├── cli/                    ← CLI 命令（40+ 子命令）
│   │   ├── commands/           ← 各子命令实现
│   │   └── tui/                ← TUI 界面（Ink/React，当前是仪表盘面板）
│   ├── dashboard/              ← Web 仪表盘
│   ├── wiki/                   ← Wiki 生成器 + 知识图谱可视化
│   └── project/                ← 项目检测 + 别名管理
├── tests/                      ← 测试（27 个子目录）
├── vendor/pi/                  ← Pi coding agent 源码（fork 用）
│   ├── .codegraph/             ← CodeGraph 索引（678 文件）
│   ├── packages/
│   │   ├── ai/                 ← LLM 抽象层
│   │   ├── agent/              ← Agent Core
│   │   ├── tui/                ← TUI 库（自研，非 Ink）
│   │   └── coding-agent/       ← Coding Agent 产品层
│   └── ...
└── docs/memcode/               ← memcode 开发文档（本目录）
```

### 3.3 MCP 工具清单（30+）
- **核心记忆**：memorix_store、memorix_search、memorix_detail、memorix_timeline、memorix_resolve
- **推理**：memorix_store_reasoning、memorix_search_reasoning
- **治理**：memorix_retention、memorix_deduplicate、memorix_audit_project
- **Formation**：memorix_formation_metrics
- **会话**：memorix_session_start、memorix_session_end
- **团队**：team_manage、team_file_lock、team_task、team_message
- **技能**：memorix_promote、memorix_skills
- **同步**：memorix_rules_sync、memorix_workspace_sync

### 3.4 存储架构

| 数据 | 后端 | 路径 | 说明 |
|------|------|------|------|
| Observations | SQLite | `~/.memorix/data/<projectId>/memories.db` | 源 of truth |
| 知识图谱 | SQLite | 同上 | Entity-Relation |
| 搜索索引 | Orama (in-memory) | 从 SQLite hydrate | BM25 + 可选向量 |
| 会话 | SQLite | 同上 | SessionStore |
| Mini-skills | SQLite | 同上 | 提升后的技能 |
| Embedding 缓存 | JSON | `~/.memorix/data/.embedding-cache.json` | 避免重启重算 |

**向量搜索**：Orama 同时承担全文和向量搜索（二合一），embedding 默认 off。三个 provider：fastembed（本地 384d）、HuggingFace transformers、OpenAI-compatible API。

### 3.5 关闭的 Issues（1.0.10 已实现但未关闭的）
- **#95** — 隐私安全 handoff receipts ✅ 已实现已关闭
- **#88** — OpenCode hook 捕获 AI 响应 ✅ 已修复已关闭
- **#87** — probe 观察类型 ✅ 全面实现已关闭
- **#86** — .env.example 保护 ✅ 已修复已关闭

剩余 open issues：
- **#49** — 持久化 agent 外部身份（远期）
- **#3** — Qwen auto-hooks（等社区反馈）

---

## 四、Memorix 记忆系统深度评估

### 4.1 竞品对比

| 竞品 | 定位 | 特点 |
|------|------|------|
| **Mem0** | 云优先记忆 API | YC 投资，自动提取记忆，ECAI 2025 论文，26k+ stars |
| **AgentMemory** | MCP 原生 | 4 层记忆整合，跨 10+ IDE，全家桶配置（太重） |
| **Zep/Graphiti** | 时序知识图谱 | 推理事实随时间变化 |
| **Letta/MemGPT** | OS 级记忆管理 | 类操作系统虚拟内存分页 |

### 4.2 Memorix 的独特价值
1. **Git-grounded memory**：commit message + diff = 不可替代的事实数据
2. **9 种 IDE 适配器**：唯一同时支持所有主流 IDE 的记忆系统
3. **Formation Pipeline**：写入时质量控制（extract → resolve → evaluate）

### 4.3 Memorix 的短板
1. **没有自动提取**：需要 agent 显式调用 store（Mem0 自动提取）
2. **11 种 type 过度分类**：agent 经常乱标
3. **搜索语义弱**：向量搜索默认 off，BM25 对语义匹配弱
4. **记忆-执行闭环弱**：存了记忆但 agent 不一定用，用了不一定有用

### 4.4 评分
| 维度 | 得分 |
|------|------|
| 架构设计 | 8/10 |
| 工程质量 | 8/10 |
| 独特性 | 7/10 |
| 实际记忆价值 | 5/10 |
| vs Mem0 | 6/10 |
| vs AgentMemory | 7/10 |

---

## 五、Pi Coding Agent 深度解剖

### 5.1 基本信息
- **作者**：Mario Zechner（libGDX 创造者）
- **组织**：Earendil Inc.
- **GitHub**：`earendil-works/pi` — 60.2k ⭐
- **协议**：MIT
- **源码**：已 clone 到 `vendor/pi/`
- **CodeGraph**：已索引（678 文件，`vendor/pi/.codegraph/`）

### 5.2 架构（4 层包）

```
packages/tui/          ← 纯 TUI 库（自研组件系统，差分渲染，~600 行，非 Ink）
packages/ai/           ← LLM 抽象层（15+ provider，统一 streaming）
packages/agent/        ← Agent Core（agent loop、session 抽象、tool 执行框架）
packages/coding-agent/ ← Coding Agent 产品层（AgentSession、SessionManager、4 工具、扩展系统）
```

**构建链**：`tui → ai → agent → coding-agent`

### 5.3 核心模块详解

#### 5.3.1 Agent Core (`packages/agent/`)

**Agent 类** (`agent.ts`):
- `prompt(text)` — 启动新一轮对话
- `continue()` — 从当前消息继续（处理 queued steering/followUp）
- `steer(message)` — 中断当前流式，注入新消息
- `followUp(message)` — 等当前完成，再注入
- 状态：`AgentState { messages: AgentMessage[] }`
- Agent 不知道 session、不知道工具，只管 messages[] 和 LLM 调用

**AgentHarness** (`harness/agent-harness.ts`):
- 连接 Agent + Session + Tools + Hooks
- `executeTurn()` 是核心方法：emitHook("before_agent_start") → runAgentLoop → flushPendingSessionWrites
- 定义了 executeToolCalls、handleAgentEvent、createStreamFn 等抽象

**Agent Loop** (`agent-loop.ts`) — 核心中的核心：
```
runLoop():
  while (true):                    ← 外循环：处理 follow-up messages
    while (hasMoreToolCalls || pendingMessages):  ← 内循环：处理 tool calls + steering
      1. 注入 pending steering messages
      2. streamAssistantResponse()
      3. if error/aborted → return
      4. 检查 toolCalls
      5. if toolCalls → executeToolCalls() → push results
      6. emit("turn_end")
    if (shouldContinue) → 继续
    else → break
  emit("agent_end")
```

**Session 抽象** (`harness/session/session.ts`):
- 树结构：每条记录有 `id` + `parentId`
- `getBranch()` — 从叶子到根的路径
- `buildSessionContext()` — 构建 LLM 消息上下文
  - 如果有 compaction：先插入压缩摘要，再追加 firstKeptEntryId 之后的消息
  - 如果没有：直接追加所有消息
- append-only 设计，崩溃安全

#### 5.3.2 Coding Agent (`packages/coding-agent/`)

**AgentSession** (`agent-session.ts`, ~2700 行) — 产品级入口：
- 把 Agent + Session + Tools + Extensions + UI 全部粘合
- 事件系统：`agent_start → turn_start → message_start/end → tool_call/result → turn_end → agent_end`
- 消息队列：steering（中断）、followUp（排队）、pendingNextTurn（下轮注入）

**SessionManager** (`session-manager.ts`) — JSONL 持久化：
- 静态工厂：`create()`、`open()`、`continueRecent()`、`forkFrom()`
- JSONL 文件格式（每行一个 JSON）：
  ```jsonl
  {"type":"session","version":7,"id":"abc","timestamp":"...","cwd":"/path"}
  {"type":"message","id":"m001","parentId":null,"message":{...}}
  {"type":"message","id":"m002","parentId":"m001","message":{...}}
  {"type":"compaction","id":"c001","parentId":"m002","summary":"...","firstKeptEntryId":"m002"}
  ```
- 路径：`~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

**4 个内置工具**：
| 工具 | 文件 | 职责 |
|------|------|------|
| read | tools/read.ts | 读文件（支持 offset/limit、图片） |
| write | tools/write.ts | 写文件 |
| edit | tools/edit.ts + edit-diff.ts | 编辑（oldText→newText，fuzzy match） |
| bash | tools/bash.ts | Shell 命令（流式输出、超时、进程树管理） |

**ToolDefinition 接口**：
```typescript
interface ToolDefinition {
  name: string; label: string; description: string;
  promptSnippet?: string; promptGuidelines?: string[];
  parameters: TSchema;  // TypeBox
  executionMode?: "sequential" | "parallel";
  execute(toolCallId, params, signal, onUpdate, ctx) → AgentToolResult;
  renderCall?(args, theme, context) → Component;
  renderResult?(result, options, theme, context) → Component;
}
```

**扩展系统** (`extensions/`):
```typescript
interface Extension {
  tools: Map<string, RegisteredTool>;
  commands: Map<string, RegisteredCommand>;
  handlers: Map<string, HandlerFn[]>;
  shortcuts: Map<KeyId, ExtensionShortcut>;
  flags: Map<string, ExtensionFlag>;
}
```

#### 5.3.3 TUI (`packages/tui/`)
- **自研组件系统**，不是 Ink/React
- 差分渲染（只重绘变化的部分）
- Component/Focusable 接口
- Editor 组件：自动补全、粘贴、撤销、历史记录、kill ring、括号粘贴模式
- TUI 事件通过 `session.subscribe(listener)` 订阅

#### 5.3.4 AI 层 (`packages/ai/`)
- 统一的 LLM 抽象
- 15+ provider 支持
- Thinking 六档：off / minimal / low / medium / high / xhigh
- 每个模型有自己的 thinkingLevelMap

### 5.4 Pi 的设计哲学
- **Primitives, not features**：只提供 4 个原语工具，其他都通过扩展实现
- **极简系统提示词**：< 1000 tokens（竞品 > 10000）
- **不做内置功能**：没有 MCP、没有 sub-agents、没有 plan mode、没有 permission popups
- **YOLO Mode**：无限制文件系统和终端访问

---

## 六、memcode 产品设计

### 6.1 产品定义
memcode 是 Memorix 的原生 coding agent，fork 自 Pi，深度融合 Memorix 记忆系统。

### 6.2 入口设计
```
npm install -g memorix
memorix              → 进入 memcode TUI（亲儿子，源码融合）
memorix serve        → MCP Server（给 Cursor/Claude Code/Codex 等外部 IDE 用）
memorix init         → 初始化项目
memorix <command>    → 其他 CLI 命令
```

**一个 npm 包，一个仓库，不独立新开。**

### 6.3 记忆集成方式
- **对外部 IDE**：MCP 协议（软连接，有性能限制）
- **对 memcode**：源码直接 import（硬连接，零开销）
  - 直接调用 `storeObservation()`，不走 MCP
  - 直接调用 `compactSearch()`，不走 MCP
  - 直接访问 SQLite / Orama，不走 MCP
  - 记忆注入在 agent 循环里原生完成

### 6.4 魔改接入点

| 接入点 | 位置 | 魔改方式 |
|--------|------|---------|
| **记忆注入** | `AgentHarness.executeTurn()` 的 `before_agent_start` hook | 调用 `compactSearch()` 注入相关记忆 |
| **记忆存储** | `AgentSession` 的 `agent_end` 事件 | 提取关键信息调用 `storeObservation()` |
| **工具扩展** | `Extension.tools` Map | 注册 memorix_search/store/detail 为原生工具 |
| **System Prompt** | `ResourceLoader` → `system-prompt.ts` | 注入记忆使用指令 |
| **Session 路径** | `SessionManager` 的 `sessionDir` | 改为 `~/.memorix/sessions/` |
| **AGENTS.md** | `ResourceLoader` 的文件发现逻辑 | 改为 `~/.memorix/AGENTS.md` + 项目级 |
| **Thinking** | `ThinkingLevelChangeEntry` | 添加六档映射 |

### 6.5 存储设计（新）
```
~/.memorix/
├── memory.db              ← SQLite（Memorix 核心，现有不动）
├── sessions.db            ← SQLite（轻量索引，可选，session picker 用）
└── sessions/<projectId>/  ← JSONL（session 对话历史，source of truth）
    ├── 20260608_a3f9k.jsonl
    └── ...
```

### 6.6 演进路线
1. **Phase 1**：Fork Pi → 搭包结构骨架 → 最小 memcode 入口（能输入、能调 LLM、能读写文件）
2. **Phase 2**：深度融合记忆系统（记忆注入/存储、原生工具）
3. **Phase 3**：TUI 定制化（memorix 品牌、记忆侧边栏、知识图谱可视化）
4. **Phase 4**：Desktop 版（基于 CLI 核心，类 Codex App）

### 6.7 上游合并策略
```
pi-mono (upstream)          memorix (fork)
  └── packages/tui/    →    TUI 层（选择性 merge，改动少）
  └── packages/ai/     →    AI 层（选择性 merge）
  └── packages/agent/  →    Agent 层（深度魔改，很少 merge）
  └── packages/coding/ →    memcode 产品层（我们的，不 merge）
```

---

## 七、全局 CLAUDE.md 配置

已重写 `C:\Users\Lenovo\.claude\CLAUDE.md`，包含：
- Identity：五条老师 + 虎杖悠仁
- Environment：Windows（非 WSL/Linux/macOS）
- Communication：默认中文
- Engineering Workflow：探索→规划→编码，Karpathy 原则
- Tools & MCP：Context7、Tavily、Playwright、Chrome DevTools、CodeGraph 使用规范
- Skills Strategy：Superpowers / deep-research / verify 等使用指南
- CodeGraph 完整使用规范
- Servers & Infrastructure

---

## 八、待办事项

### 立即要做
- [ ] 写正式 memcode 开发文档（基于本交接文档）
- [ ] 修复 memorix 全局安装（Windows npm link 损坏，需管理员权限）
- [ ] 构建 dist（`npm run build`）

### 1.0.11 目标
- [ ] Fork Pi 源码到 memorix 代码结构中
- [ ] 搭 monorepo 包结构骨架
- [ ] 最小 memcode 入口跑通
- [ ] 记忆系统深度融合（记忆注入/存储）

### 远期
- [ ] TUI 定制化
- [ ] Desktop 版
- [ ] Sub-agent 支持（通过 extension 机制）
- [ ] Embedding 默认改为 auto
- [ ] 简化记忆模型（11 种 type → 3-4 种高信号类型）

---

## 九、关键文件索引

### Pi 源码关键文件（vendor/pi/）
| 文件 | 作用 |
|------|------|
| `packages/agent/src/agent.ts` | Agent 类（prompt/continue/steer/followUp） |
| `packages/agent/src/agent-loop.ts` | 核心循环 runLoop |
| `packages/agent/src/harness/agent-harness.ts` | AgentHarness（连接 Agent+Session+Tools） |
| `packages/agent/src/harness/session/session.ts` | Session 抽象 + buildSessionContext |
| `packages/coding-agent/src/core/agent-session.ts` | AgentSession（~2700行，主粘合类） |
| `packages/coding-agent/src/core/agent-session-runtime.ts` | 会话生命周期管理 |
| `packages/coding-agent/src/core/session-manager.ts` | JSONL 持久化 + tree-structured |
| `packages/coding-agent/src/core/sdk.ts` | createAgentSession SDK 入口 |
| `packages/coding-agent/src/core/tools/bash.ts` | Bash 工具实现 |
| `packages/coding-agent/src/core/tools/edit.ts` | Edit 工具实现 |
| `packages/coding-agent/src/core/extensions/types.ts` | Extension/ToolDefinition 接口 |
| `packages/coding-agent/src/core/extensions/runner.ts` | ExtensionRunner |
| `packages/coding-agent/src/core/agent-session-services.ts` | AgentSessionServices |
| `packages/tui/src/components/editor.ts` | TUI Editor 组件 |
| `packages/tui/src/tui.ts` | TUI 核心（Component/Focusable 接口） |

### Memorix 关键文件
| 文件 | 作用 |
|------|------|
| `src/server.ts` | MCP Server 核心（~4100行，30+工具） |
| `src/memory/observations.ts` | 核心写入链路 |
| `src/memory/graph.ts` | KnowledgeGraphManager |
| `src/memory/formation/` | Formation Pipeline |
| `src/store/obs-store.ts` | ObservationStore |
| `src/store/orama-store.ts` | Orama 搜索索引 |
| `src/store/sqlite-store.ts` | SQLite 后端 |
| `src/compact/engine.ts` | 3 层渐进式披露引擎 |
| `src/llm/provider.ts` | LLM Provider |
| `src/embedding/provider.ts` | Embedding Provider |
| `src/cli/tui/` | TUI 界面（Ink/React） |
| `src/hooks/` | Hook 系统 |
| `src/types.ts` | 全局类型定义 |
| `CLAUDE.md` | 项目级 Claude 指令 |

---

> 五条老师说：「我们的羁绊！！！」
> 虎杖悠仁说：「老师放心，记忆已经存好了。下次见面，我还认识你。」
