<p align="center">
  <img src="https://raw.githubusercontent.com/AVIDS2/memorix/main/assets/readme-logo-bridge.png" alt="Memorix Bridge" width="720">
</p>

<h1 align="center">Memorix</h1>

<p align="center">
  <strong>面向 Coding Agent 的开源跨 Agent Memory Layer。</strong><br>
  通过 MCP 为 Cursor、Claude Code、Codex、Windsurf、Gemini CLI、GitHub Copilot、Kiro、OpenCode、Antigravity 和 Trae 提供分级支持。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/v/memorix.svg?style=flat-square&color=cb3837" alt="npm"></a>
  <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/dm/memorix.svg?style=flat-square&color=blue" alt="downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green.svg?style=flat-square" alt="license"></a>
  <a href="https://github.com/AVIDS2/memorix/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/AVIDS2/memorix/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/AVIDS2/memorix"><img src="https://img.shields.io/github/stars/AVIDS2/memorix?style=flat-square&color=yellow" alt="stars"></a>
</p>

<p align="center">
  <strong>三层记忆</strong> | <strong>团队协作</strong> | <strong>工作区同步</strong> | <strong>多 Agent 编排</strong> | <strong>Dashboard</strong>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="#docker">Docker</a> |
  <a href="#快速开始">快速开始</a> |
  <a href="#支持的客户端">支持的客户端</a> |
  <a href="#常用工作流">常用工作流</a> |
  <a href="#文档导航">文档导航</a> |
  <a href="docs/SETUP.md">安装与接入</a>
</p>

---

> 如果你是通过 Cursor、Windsurf、Claude Code、Codex 或其他 AI coding agent 来操作 Memorix，请先读 [Agent Operator Playbook](docs/AGENT_OPERATOR_PLAYBOOK.md)。那份文档是面向 agent 的安装、MCP、hook 和排障手册。

## Memorix 是什么？

**Memorix 是一个面向 Coding Agent 的、本地优先的记忆控制面。**

它把项目记忆、推理上下文、Git 导出的工程事实，以及可选的协作状态放在同一套本地系统里，让你可以在 IDE、终端、不同 session 和自主 agent 运行之间持续推进同一个项目，而不丢失上下文。

对大多数用户来说，默认路径其实很简单：直接用本地 TUI/CLI，或者把一个 IDE 通过 stdio MCP 接进来。HTTP 更适合作为你主动启用的共享控制面模式，用在 dashboard、长驻后台服务，或多个客户端共享协作状态的场景里。

## 为什么选择 Memorix

**唯一同时保留 Git 真相、推理上下文和本地控制权的跨 Agent 记忆层 — 支持 10 个 IDE 和 Agent。**

大多数 Coding Agent 只记得当前线程。Memorix 提供的是一层共享、持久、可检索的项目记忆，让不同 IDE、不同 Agent、不同会话都能在同一套本地记忆库上继续工作。

<table>
<tr><td><b>🧠 三层记忆</b></td><td>Observation（what/how）、Reasoning（why/权衡）、Git Memory（不可变 commit 事实 + 噪音过滤）</td></tr>
<tr><td><b>🔍 Source-Aware 检索</b></td><td>"改了什么"倾向 Git Memory；"为什么"倾向推理记忆；默认项目作用域，可切全局</td></tr>
<tr><td><b>⚙️ 记忆质量管线</b></td><td>Formation（LLM 评估）、去重、合并、保留衰减——记忆保持干净，不会越积越噪</td></tr>
<tr><td><b>🔄 工作区 & 规则同步</b></td><td>一条命令迁移 MCP 配置、工作流、规则、技能到 Cursor/Windsurf/Claude Code/Codex/Copilot/Kiro 等</td></tr>
<tr><td><b>👥 团队协作</b></td><td>面向自主 Agent 的显式协作状态：任务板（角色认领）、Agent 间消息、文件锁、态势感知 poll</td></tr>
<tr><td><b>🤖 多 Agent 编排</b></td><td><code>memorix orchestrate</code> 运行结构化协作循环——计划→并行执行→验证→修复→审查——带能力路由和 worktree 隔离</td></tr>
<tr><td><b>📋 Session 生命周期</b></td><td>Session start/end + 交接摘要、水位线追踪（上次以来的新记忆）、跨 session 上下文恢复</td></tr>
<tr><td><b>🎯 项目技能</b></td><td>从记忆模式自动生成 SKILL.md；将观察提升为永久 mini-skill，session 启动时自动注入</td></tr>
<tr><td><b>📊 Dashboard</b></td><td>本地 Web UI：浏览记忆、Git 历史、活跃协作状态和任务板；Team 视图需要 HTTP 控制面</td></tr>
<tr><td><b>🔒 本地 & 私有</b></td><td>SQLite 为权威存储、Orama 为检索引擎、无云依赖——一切留在你的机器上</td></tr>
</table>

## 支持的客户端

| 层级 | 客户端 |
|------|--------|
| ★ 核心 | Claude Code, Cursor, Windsurf |
| ◆ 扩展 | GitHub Copilot, Kiro, Codex |
| ○ 社区 | Gemini CLI, OpenCode, Antigravity, Trae |

**核心** = 完整 hook 集成 + 测试过的 MCP + 规则同步。**扩展** = hook 集成但有平台限制。**社区** = 尽力适配，兼容性由社区反馈。

如果某个客户端能通过 MCP 连接本地命令或 HTTP 端点，通常也可以接入 Memorix，只是暂时没有单独的适配器或引导页。

---

## 快速开始

全局安装：

```bash
npm install -g memorix
```

初始化 Memorix 配置：

```bash
memorix init
```

`memorix init` 会让你在 `Global defaults` 和 `Project config` 之间选择作用域。

Memorix 使用两类文件：

- `memorix.yml`：行为配置和项目设置
- `.env`：API key 等 secrets

然后按你的目标选择一条最顺手的路径：

| 你想做什么 | 运行命令 | 适合场景 |
| --- | --- | --- |
| 交互式终端工作台 | `memorix` | 默认起手式：本地搜索、聊天、记忆录入、诊断都在一个全屏 TUI 里完成 |
| 先把 Memorix 快速接到一个 IDE 里 | `memorix serve` | 默认 MCP 路径，适合 Cursor、Claude Code、Codex、Windsurf、Gemini CLI 等 stdio 客户端 |
| 在后台长期运行 HTTP MCP + Dashboard | `memorix background start` | 当你明确需要共享控制面、dashboard、多个客户端或协作状态时再启用 |
| 把 HTTP 模式放在前台调试或自定义端口 | `memorix serve-http --port 3211` | 调试、手动观察日志、自定义启动方式 |

对大多数用户来说，选上面前两条之一就够了。只有在你明确想要 dashboard、共享后台服务或多客户端协作时，再切到 HTTP。

心智模型：

| 如果你是... | 使用... | 原因 |
| --- | --- | --- |
| 人类用户在终端里操作 Memorix | `memorix` 或 `memorix <command>` | CLI/TUI 是主要产品入口。 |
| IDE 或 Coding Agent 只需要记忆能力 | 优先 `memorix serve`；需要时再用 HTTP + `memorix_session_start` | 启动轻量记忆会话；默认不加入 team。 |
| 需要自主多 Agent 开发循环 | `memorix orchestrate` | 这是实际的多 Agent loop：计划、启动 CLI agents、验证、修复、审查。 |
| 需要观察共享项目状态 | `memorix background start` + Dashboard | Dashboard 展示当前项目记忆和显式加入后的协作状态。 |

配套命令：`memorix background status|logs|stop`。多工作区 HTTP session 需用 `memorix_session_start(projectRoot=...)` 绑定。

更细的启动根路径选择、项目绑定、配置优先级和 agent 操作说明：[docs/SETUP.md](docs/SETUP.md) 和 [Agent Operator Playbook](docs/AGENT_OPERATOR_PLAYBOOK.md)。

### TUI 工作台

![Memorix TUI Workbench](https://raw.githubusercontent.com/AVIDS2/memorix/main/assets/readme-tui-workbench.png)

在终端中直接运行 `memorix`（不带参数）即可打开交互式全屏 TUI（需要 TTY）。它适合用于项目记忆问答、搜索、快速存储、诊断、后台服务控制、Dashboard 打开和 IDE 配置。进入 TUI 后用 `/help` 查看当前命令列表。

单次聊天（不进 TUI）：`memorix ask "你的问题"`。

### Operator CLI

Memorix 现在提供的是一套 **CLI-first 的 operator 命令面**。你可以直接在终端里完成完整操作，不必什么都绕到 MCP tool call；MCP 继续作为 IDE / agent 的集成协议层存在。

```bash
memorix session start --agent codex-main --agentType codex
memorix memory search --query "docker control plane"
memorix reasoning search --query "why sqlite"
memorix retention status
memorix team status
memorix task list
memorix audit project
memorix sync workspace --action scan
```

这组 CLI 故意做成“人类可读”的命名空间，而不是把 MCP 工具名原样搬出来。原生能力可以通过 `session`、`memory`、`reasoning`、`retention`、`formation`、`audit`、`transfer`、`skills`、`team`、`task`、`message`、`lock`、`handoff`、`poll`、`sync`、`ingest` 进入；MCP 继续保留为 IDE / agent 接入层和可选 graph compatibility 层。

把 Memorix 加进你的 MCP 客户端：

### 通用 stdio MCP 配置

```json
{
  "mcpServers": {
    "memorix": {
      "command": "memorix",
      "args": ["serve"]
    }
  }
}
```

### 通用 HTTP MCP 配置

```json
{
  "mcpServers": {
    "memorix": {
      "transport": "http",
      "url": "http://localhost:3211/mcp"
    }
  }
}
```

下面这些客户端示例展示的是最简单的 stdio 形态。如果你更想使用共享的 HTTP control plane，请沿用上面的通用 HTTP 配置块，并到 [docs/SETUP.md](docs/SETUP.md) 查看各客户端字段差异。

<details open>
<summary><strong>Cursor</strong> | <code>.cursor/mcp.json</code></summary>

```json
{
  "mcpServers": {
    "memorix": {
      "command": "memorix",
      "args": ["serve"]
    }
  }
}
```
</details>

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add memorix -- memorix serve
```
</details>

<details>
<summary><strong>Codex</strong> | <code>~/.codex/config.toml</code></summary>

```toml
[mcp_servers.memorix]
command = "memorix"
args = ["serve"]
```
</details>

完整 IDE 配置矩阵、Windows 注意事项和排障说明见 [docs/SETUP.md](docs/SETUP.md)。

---

## 常用工作流

| 你想做什么 | 使用方式 | 详细说明 |
| --- | --- | --- |
| 保存和检索项目记忆 | `memorix memory store/search/detail/resolve` 或 MCP `memorix_store/search/detail/resolve` | [API Reference](docs/API_REFERENCE.md#3-core-memory-tools) |
| 捕获 Git 真相 | `memorix git-hook --force`、`memorix ingest commit`、`memorix ingest log` | [Git Memory Guide](docs/GIT_MEMORY.md) |
| 运行 Dashboard + HTTP MCP | `memorix background start` | [Setup Guide](docs/SETUP.md)、[Docker](docs/DOCKER.md) |
| 保持记忆会话轻量 | `memorix_session_start(projectRoot=...)` 或 `memorix session start` | [Agent Operator Playbook](docs/AGENT_OPERATOR_PLAYBOOK.md#8-what-an-agent-should-do-at-session-start) |
| 显式加入协作空间 | `memorix session start --joinTeam` 或 `memorix team join` | [TEAM.md](TEAM.md)、[API Reference](docs/API_REFERENCE.md#9-team-collaboration-tools) |
| 运行自主多 Agent 工作 | `memorix orchestrate --goal "..."` | [API Reference](docs/API_REFERENCE.md) |
| 同步 Agent 配置/规则 | `memorix sync workspace ...`、`memorix sync rules ...` | [Setup Guide](docs/SETUP.md) |
| 在代码里直接调用 | `import { createMemoryClient } from 'memorix/sdk'` | [API Reference](docs/API_REFERENCE.md) |

最常见的循环故意保持很小：

```bash
memorix memory store --text "Auth tokens expire after 24h" --title "Auth token TTL" --entity auth --type decision
memorix memory search --query "auth token ttl"
memorix session start --agent codex-main --agentType codex
```

当多个 HTTP session 同时存在时，每个 session 都应先用 `memorix_session_start(projectRoot=...)` 显式绑定当前工作区，再去调用项目级记忆工具。

HTTP MCP session 默认 30 分钟空闲后过期。如果你的客户端不会自动从陈旧 HTTP session ID 中恢复，可以在启动控制面前设置更长超时：

```bash
MEMORIX_SESSION_TIMEOUT_MS=86400000 memorix background start  # 24 小时
```

Team 协作不是普通记忆启动路径，也不是多个 IDE 对话窗口之间的聊天室。只有需要任务、消息、文件锁，或结构化自主 Agent 工作流时，才加入 team。真正的多 Agent 执行优先使用：

```bash
memorix orchestrate --goal "Add user authentication" --agents claude-code,cursor,codex
```

## 资源占用

Memorix 的普通记忆路径设计为轻量运行：

- stdio MCP 按需启动，随客户端退出
- HTTP background 模式是一个本地 Node 进程，加 SQLite/Orama 状态
- LLM enrichment 是可选能力；没有 API key 时会回退到本地启发式去重和检索
- 更重的路径主要是 build/test、Docker 镜像构建、Dashboard 浏览、大批量导入和可选 LLM-backed formation

在这台 Windows 开发机上，健康的 HTTP 控制面空闲数小时后观测到约 16 MB working set。这只是本机观测值，不是跨平台承诺。更多旋钮和取舍见 [Performance and Resource Notes](docs/PERFORMANCE.md)。

## 编程 SDK

直接在你自己的 TypeScript/Node.js 项目中 import Memorix —— 无需 MCP 或 CLI：

```ts
import { createMemoryClient } from 'memorix/sdk';

const client = await createMemoryClient({ projectRoot: '/path/to/repo' });

// 存储记忆
await client.store({
  entityName: 'auth-module',
  type: 'decision',
  title: 'Use JWT for API auth',
  narrative: 'Chose JWT over session cookies for stateless API.',
});

// 搜索
const results = await client.search({ query: 'authentication' });

// 查询、归档、计数
const obs = await client.get(1);
const all = await client.getAll();
await client.resolve([1, 2]);

await client.close();
```

三个子路径导出：

| Import | 内容 |
| --- | --- |
| `memorix/sdk` | `createMemoryClient`、`createMemorixServer`、`detectProject`、全部类型 |
| `memorix/types` | 纯类型 —— interface、enum、常量 |
| `memorix` | MCP stdio 入口（不适合编程使用） |

---

## 工作原理

<p align="center">
  <img src="assets/architecture.svg" alt="Memorix Architecture" width="960">
</p>

Memorix 不是一条单线流水线。它从多个入口接收记忆，把内容落到多种记忆基底上，经过异步质量与索引处理，再通过不同的检索和协作界面提供给用户与 agent。

### 记忆层

- **Observation Memory**：记录“改了什么 / 系统怎么工作 / 踩过什么坑”
- **Reasoning Memory**：记录“为什么这么做 / 替代方案 / 权衡 / 风险”
- **Git Memory**：记录从提交中提炼出的工程事实

### 检索模型

- 默认搜索是**当前项目作用域**
- `scope="global"` 可以跨项目搜索
- 全局结果可通过带项目信息的 ref 再展开
- source-aware retrieval 会对“发生了什么”问题偏向 Git Memory，对“为什么”问题偏向 reasoning memory

---

## 文档导航

📖 **[文档地图](docs/README.md)** — 最快找到你需要的文档。

| 章节 | 内容 |
| --- | --- |
| [安装与接入](docs/SETUP.md) | 安装、stdio vs HTTP control plane、各客户端配置 |
| [Docker 部署](docs/DOCKER.md) | 官方容器路径、compose、healthcheck 和路径注意事项 |
| [性能与资源](docs/PERFORMANCE.md) | 资源画像、空闲/运行时成本、优化旋钮 |
| [配置指南](docs/CONFIGURATION.md) | `memorix.yml`、`.env`、项目覆盖 |
| [Agent Operator Playbook](docs/AGENT_OPERATOR_PLAYBOOK.md) | AI 面向的正式操作手册：安装、绑定、hooks、排障 |
| [架构](docs/ARCHITECTURE.md) | 系统形态、记忆层、数据流、模块图 |
| [API 参考](docs/API_REFERENCE.md) | MCP / HTTP / CLI 命令面 |
| [Git Memory 指南](docs/GIT_MEMORY.md) | 摄入、噪音过滤、检索语义 |
| [开发指南](docs/DEVELOPMENT.md) | 贡献者工作流、构建、测试、发布 |

更多深度参考：

- [Memory Formation Pipeline](docs/MEMORY_FORMATION_PIPELINE.md)
- [Design Decisions](docs/DESIGN_DECISIONS.md)
- [Modules](docs/MODULES.md)
- [Known Issues and Roadmap](docs/KNOWN_ISSUES_AND_ROADMAP.md)
- [AI Context Note](docs/AI_CONTEXT.md)
- [`llms.txt`](llms.txt)
- [`llms-full.txt`](llms-full.txt)

---

## Docker

Memorix 现在提供了面向 **HTTP control plane** 的官方 Docker 部署路径。

快速启动：

```bash
docker compose up --build -d
```

启动后可访问：

- Dashboard：`http://localhost:3211`
- MCP：`http://localhost:3211/mcp`
- 健康检查：`http://localhost:3211/health`

需要注意：Docker 支持的是 `serve-http`，不是 `memorix serve`。如果容器看不到你要绑定的仓库路径，那么项目级 Git / 配置语义不会完整生效。

完整说明见：[docs/DOCKER.md](docs/DOCKER.md)

## 1.0.8 更新亮点

`1.0.8` 在 1.0.7 的多 Agent 协调 / SQLite / 团队身份基线上，进一步收成了 CLI-first operator surface、官方 Docker 路径、Dashboard 语义分层和大量 Hooks 修复。

- **CLI-First 产品面**：所有 Memorix 原生能力都已经有面向人的 CLI 路径（`session`、`memory`、`reasoning`、`retention`、`formation`、`audit`、`transfer`、`skills`、`team`、`task`、`message`、`lock`、`handoff`、`poll`、`sync`、`ingest`）。MCP 保留为标准接入协议和可选 graph compatibility 层。
- **Docker 部署**：官方 `Dockerfile`、`compose.yaml`、健康检查、`--host` 绑定，详见 [DOCKER.md](docs/DOCKER.md)。
- **多 Agent 协调器**：`memorix orchestrate` 运行计划、并行执行、验证、修复、审查和合并循环。支持 Claude、Codex、Gemini CLI、OpenCode，含能力路由、worktree 隔离和 Agent 回退。
- **SQLite 统一存储**：Observation、mini-skill、session、archive 全部 SQLite。共享 DB 句柄，检索前自动刷新，已删除废弃的 `JsonBackend`。
- **显式协作空间**：任务板、消息、文件锁、交接产物和协作者心跳状态。`session_start` 默认保持轻量；只有 `joinTeam` 或 `team_manage join` 才会显式加入协作空间。
- **Dashboard 语义分层**：Team 页面过滤标签（Active / Recent / Historical）；历史 Agent 降低显示权重；项目选择器按 真实 / 临时 / 占位 分组；Identity 页面优化。
- **Hooks 修复**：OpenCode 事件键映射 + `Bun.spawn` → `spawnSync`；Copilot `pwsh` 回退 + 全局 hooks 拦截；hook handler 诊断日志。
- **编程 SDK**：`import { createMemoryClient } from 'memorix/sdk'` 可直接在代码中 store / search / get / resolve，无需 MCP 或 CLI。同时导出 `createMemorixServer` 和 `detectProject`。
- **测试稳定化**：E2e 和 live-LLM 测试从默认套件中排除；负载敏感测试隔离运行，让默认验证路径保持确定。

---

## 开发

```bash
git clone https://github.com/AVIDS2/memorix.git
cd memorix
npm install

npm run dev
npm test
npm run build
```

常用本地命令：

```bash
memorix status
memorix dashboard
memorix background start
memorix serve-http --port 3211
memorix git-hook --force
```

---

## 鸣谢

Memorix 借鉴了 [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service)、[MemCP](https://github.com/maydali28/memcp)、[claude-mem](https://github.com/anthropics/claude-code)、[Mem0](https://github.com/mem0ai/mem0) 和整个 MCP 生态中的许多思路。

## Star 历史

<a href="https://star-history.com/#AVIDS2/memorix&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=AVIDS2/memorix&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=AVIDS2/memorix&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=AVIDS2/memorix&type=Date" width="600" />
 </picture>
</a>

## License

[Apache 2.0](LICENSE)
