<p align="center">
  <img src="assets/logo.png" alt="Memorix" width="120">
</p>

<h1 align="center">Memorix</h1>

<p align="center">
  <strong>面向 Coding Agent 的开源跨 Agent Memory Layer。</strong><br>
  通过 MCP 兼容 Cursor、Claude Code、Codex、Windsurf、Gemini CLI、GitHub Copilot、Kiro、OpenCode、Antigravity 和 Trae。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/v/memorix.svg?style=flat-square&color=cb3837" alt="npm"></a>
  <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/dm/memorix.svg?style=flat-square&color=blue" alt="downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green.svg?style=flat-square" alt="license"></a>
  <a href="https://github.com/AVIDS2/memorix/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/AVIDS2/memorix/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/AVIDS2/memorix"><img src="https://img.shields.io/github/stars/AVIDS2/memorix?style=flat-square&color=yellow" alt="stars"></a>
</p>

<p align="center">
  <strong>Git Memory</strong> | <strong>Reasoning Memory</strong> | <strong>跨 Agent 召回</strong> | <strong>Control Plane Dashboard</strong>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="#快速开始">快速开始</a> |
  <a href="#支持的客户端">支持的客户端</a> |
  <a href="#核心工作流">核心工作流</a> |
  <a href="#文档导航">文档导航</a> |
  <a href="docs/SETUP.md">安装与接入</a>
</p>

---

## 给 Coding Agent 的说明

如果你在用 AI coding agent 帮用户安装、配置或排障 Memorix，请先阅读 [Agent Operator Playbook](docs/AGENT_OPERATOR_PLAYBOOK.md)。

这份文档是给 Agent 的正式操作手册，重点说明：

- 安装与运行模式选择
- Git 与项目身份绑定规则
- stdio 与 HTTP control plane 的取舍
- 各 Agent / IDE 的集成与 hooks
- dot 目录生成策略
- 排障顺序和安全操作边界

## 为什么是 Memorix

大多数 Coding Agent 只能记住当前线程。Memorix 提供的是一层共享、持久、可检索的项目记忆，让不同 IDE、不同 Agent、不同会话都能在同一套本地记忆库上继续工作。

Memorix 的几个关键差异点：

- **Git Memory**：把 `git commit` 变成可检索的工程记忆，保留提交来源、变更文件和噪音过滤结果。
- **Reasoning Memory**：不只记录“改了什么”，还记录“为什么这么做”。
- **跨 Agent 本地召回**：多个 IDE 和 Agent 可以读取同一套本地记忆，而不是各自形成孤岛。
- **记忆质量管线**：formation、压缩、保留衰减和 source-aware retrieval 协同工作，而不是一堆彼此独立的小功能。

一句话说，Memorix 解决的是：让多个 Coding Agent 通过 MCP 共享同一套耐久项目记忆，同时保留 Git 真相、推理上下文和本地控制权。

## 支持的客户端

当前已经做了明确适配的集成目标有：

- Cursor
- Claude Code
- Codex
- Windsurf
- Gemini CLI
- GitHub Copilot
- Kiro
- OpenCode
- Antigravity
- Trae

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

`memorix init` 会让你在 `Global defaults` 和 `Project config` 之间做作用域选择。

Memorix 使用两个文件、两类职责：

- `memorix.yml`：行为配置和项目级设置
- `.env`：密钥和敏感变量

然后按你的目标选择一条最顺手的路径：

| 你想做什么 | 运行命令 | 适合场景 |
| --- | --- | --- |
| 先把 Memorix 快速接到一个 IDE 里 | `memorix serve` | Cursor、Claude Code、Codex、Windsurf、Gemini CLI 等 stdio MCP 客户端 |
| 在后台长期运行 HTTP MCP + Dashboard | `memorix background start` | 日常使用、多个 Agent、协作、dashboard |
| 把 HTTP 模式放在前台调试或自定义端口 | `memorix serve-http --port 3211` | 调试、手动观察日志、自定义启动方式 |

对大多数用户来说，先从下面两条里选一条就够了：

- `memorix serve`：你只想尽快在 IDE 里用起来
- `memorix background start`：你想要 dashboard 和后台常驻的 HTTP control plane

如果你想先看本地交互式工作台，也可以直接运行：

```bash
memorix
```

如果你在 TTY 中想直接使用交互式本地工作台，运行裸命令 `memorix`。

```bash
memorix serve
```

`serve` 适合最直接、最轻量的 stdio MCP 接入。

```bash
memorix background start
```

`background start` 会把同一个 HTTP control plane 放到后台，适合日常使用 dashboard、协作能力和 HTTP MCP，而不用一直守着前台终端。

配套命令：

```bash
memorix background status
memorix background logs
memorix background stop
```

如果你确实需要把 HTTP control plane 放在前台运行、做调试、手动观察日志或使用自定义端口，再用：

```bash
memorix serve-http --port 3211
```

`serve-http` 启动时会按下面的顺序为默认项目根做初始选择：

1. `--cwd`
2. `MEMORIX_PROJECT_ROOT`
3. `~/.memorix/last-project-root`
4. `process.cwd()`

在 HTTP control-plane 模式下，如果 Agent 能拿到当前工作区绝对路径，就应该在调用 `memorix_session_start` 时把它作为 `projectRoot` 传入。`projectRoot` 只是检测锚点，最终项目身份仍然以 Git 为准。

把 Memorix 加入 MCP 配置：

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

## 核心工作流

### 1. 存储与检索项目记忆

常用 MCP 工具包括：

- `memorix_store`
- `memorix_search`
- `memorix_detail`
- `memorix_timeline`
- `memorix_resolve`

这条主链适合沉淀决策、坑点、问题修复和会话交接。

### 2. 自动捕获 Git 真相

安装 post-commit hook：

```bash
memorix git-hook --force
```

或者手动导入：

```bash
memorix ingest commit
memorix ingest log --count 20
```

Git Memory 会保留 `source='git'`、提交哈希、文件变化和噪音过滤结果。

### 3. 运行控制面与 Dashboard

```bash
memorix background start
```

然后访问：

- MCP HTTP 端点：`http://localhost:3211/mcp`
- Dashboard：`http://localhost:3211`

配套命令：

```bash
memorix background status
memorix background logs
memorix background stop
```

如果你需要把控制面放在前台做调试或手动观察，也可以使用：

```bash
memorix serve-http --port 3211
```

这一模式会把 dashboard、配置诊断、项目身份、团队协作和 Git Memory 视图统一到一个控制面入口里。

当多个 HTTP session 同时存在时，每个 session 都应先用 `memorix_session_start(projectRoot=...)` 显式绑定当前工作区，再去调用项目级记忆工具。

---

## 工作原理

```mermaid
flowchart LR
    subgraph Ingress["入口层"]
        A1["Git hooks / ingest"]
        A2["MCP tools"]
        A3["CLI / TUI"]
        A4["HTTP dashboard"]
    end

    subgraph Runtime["Memorix Runtime"]
        B1["stdio MCP server"]
        B2["HTTP control plane"]
        B3["project binding + config"]
    end

    subgraph Memory["记忆基底"]
        C1["Observation memory"]
        C2["Reasoning memory"]
        C3["Git memory"]
        C4["Session + team state"]
    end

    subgraph Processing["异步处理"]
        D1["Formation pipeline"]
        D2["Embedding + indexing"]
        D3["Graph linking"]
        D4["Dedup + retention"]
    end

    subgraph Consumption["消费面"]
        E1["Search / detail / timeline"]
        E2["Dashboard / team views"]
        E3["Agent recall / handoff"]
    end

    A1 --> B1
    A2 --> B1
    A2 --> B2
    A3 --> B1
    A3 --> B2
    A4 --> B2

    B1 --> B3
    B2 --> B3

    B3 --> C1
    B3 --> C2
    B3 --> C3
    B3 --> C4

    C1 --> D1
    C1 --> D2
    C1 --> D3
    C1 --> D4
    C2 --> D1
    C2 --> D3
    C3 --> D2
    C4 --> D3

    D1 --> E1
    D2 --> E1
    D2 --> E2
    D3 --> E2
    D3 --> E3
    D4 --> E1
```

Memorix 不是一条单线的“写入 -> 处理 -> 查询”管线。它更像是一个 fan-in / fan-out 的记忆系统：

- 多个入口同时写入
- 一套运行时和多种记忆基底
- 发生在后台的异步处理支路
- 向搜索、dashboard、team、会话交接同时提供消费面

这就是为什么它能同时支持 Git Truth、Reasoning Memory、Cross-Agent Recall 和 Control Plane 协作，而不是只做一个单点记忆工具。

---

## 文档导航

- [安装与接入说明](docs/SETUP.md)
- [配置模型](docs/CONFIGURATION.md)
- [Git Memory 指南](docs/GIT_MEMORY.md)
- [架构设计](docs/ARCHITECTURE.md)
- [Agent 操作手册](docs/AGENT_OPERATOR_PLAYBOOK.md)
- [AI Context Note](docs/AI_CONTEXT.md)
- [面向 AI 的项目索引（短版）](llms.txt)
- [面向 AI 的项目索引（完整版）](llms-full.txt)
