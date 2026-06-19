<p align="center">
  <img src="https://raw.githubusercontent.com/AVIDS2/memorix/main/assets/readme-logo-bridge.png" alt="Memorix" width="720">
</p>

<h1 align="center">Memorix</h1>

<p align="center">
  <strong>面向 AI Coding Agent 的本地优先共享记忆层。</strong><br>
  让 Claude Code、Codex、Cursor、Windsurf、Copilot、Gemini CLI、OpenCode、Kiro、Antigravity、Trae、memcode 和任何 MCP Agent 共用同一套项目记忆。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/v/memorix.svg?style=for-the-badge&logo=npm&color=cb3837" alt="npm"></a>
  <a href="https://github.com/AVIDS2/memorix/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/AVIDS2/memorix/ci.yml?style=for-the-badge&label=CI&logo=github" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-2563eb?style=for-the-badge" alt="license"></a>
  <a href="https://github.com/AVIDS2/memorix"><img src="https://img.shields.io/github/stars/AVIDS2/memorix?style=for-the-badge&logo=github&color=facc15" alt="stars"></a>
</p>

<p align="center">
  <strong>共享项目记忆</strong> | <strong>MCP</strong> | <strong>Git Memory</strong> | <strong>Reasoning Memory</strong> | <strong>Dashboard</strong> | <strong>Agent Team</strong>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="#安装">安装</a> |
  <a href="#支持你的-agent">Agents</a> |
  <a href="#快速开始">快速开始</a> |
  <a href="#记忆模型">记忆模型</a> |
  <a href="#memcodefirst-party-memagent">memcode</a> |
  <a href="#文档">文档</a>
</p>

---

## Memorix 是什么

Memorix 是 AI 软件开发的记忆层，不是要求你换用的另一个 Agent。它把项目事实、决策原因、Git 改动和 session 摘要沉淀到本地、持久、可检索的记忆里，让不同 Agent 可以沿着同一份上下文继续工作。

今天用 Claude Code，明天用 Codex，下午在 Cursor，必要时再开 memcode。记忆都归属于 Git 项目和用户，而不是被锁在某个聊天窗口或某个工具里。

| 问题 | Memorix 提供什么 |
| --- | --- |
| 下一个 session 忘了上一个 session 学到的东西 | 项目级记忆、session 摘要、timeline 和 detail 检索 |
| 不同 Agent 各记各的 | 通过 MCP、hooks、CLI、SDK 和 memcode 共享同一套本地记忆池 |
| Git 记录了改动，但 Agent 很难检索工程事实 | Git Memory 把 commit 转成可搜索的工程记忆 |
| 架构决策散落在旧聊天里 | Reasoning Memory 存储原因、替代方案和 trade-off |
| 静态规则文件容易过期 | 坑点、修复和项目技能从真实工作中持续沉淀 |
| 多 Agent 协作容易乱 | 可选 Agent Team：任务、消息、交接、文件锁和编排 |

Memorix 是本地优先的。SQLite 是权威存储，Orama 负责搜索，LLM 记忆整理和 embedding 是可选能力。没有模型 key 时，Memorix 仍然可以用本地全文检索工作。

## 支持你的 Agent

只要 Agent 能启动本地 MCP server、连接 HTTP MCP，或执行 hooks，通常就可以接入 Memorix。不同客户端的集成深度不同。

<table>
<tr>
<td align="center" width="12.5%">
<a href="https://claude.com/product/claude-code"><img src="https://github.com/anthropics.png?size=120" alt="Claude Code" width="48" height="48"></a><br>
<strong>Claude Code</strong><br>
<sub>Core: MCP + hooks + rules</sub>
</td>
<td align="center" width="12.5%">
<a href="https://openai.com/codex"><img src="https://github.com/openai.png?size=120" alt="Codex" width="48" height="48"></a><br>
<strong>Codex</strong><br>
<sub>Extended: MCP + rules</sub>
</td>
<td align="center" width="12.5%">
<a href="https://cursor.com"><picture><source media="(prefers-color-scheme: dark)" srcset="https://svgl.app/library/cursor_dark.svg"><img src="https://svgl.app/library/cursor_light.svg" alt="Cursor" width="48" height="48"></picture></a><br>
<strong>Cursor</strong><br>
<sub>Core: MCP + rules</sub>
</td>
<td align="center" width="12.5%">
<a href="https://windsurf.com"><picture><source media="(prefers-color-scheme: dark)" srcset="https://svgl.app/library/windsurf-dark.svg"><img src="https://svgl.app/library/windsurf-light.svg" alt="Windsurf" width="48" height="48"></picture></a><br>
<strong>Windsurf</strong><br>
<sub>Core: MCP + hooks</sub>
</td>
<td align="center" width="12.5%">
<a href="https://github.com/features/copilot"><img src="https://github.githubassets.com/images/modules/site/copilot/copilot.png" alt="GitHub Copilot" width="48" height="48"></a><br>
<strong>Copilot</strong><br>
<sub>Extended: VS Code MCP</sub>
</td>
<td align="center" width="12.5%">
<a href="https://github.com/google-gemini/gemini-cli"><img src="https://github.com/google-gemini.png?size=120" alt="Gemini CLI" width="48" height="48"></a><br>
<strong>Gemini CLI</strong><br>
<sub>Community: MCP</sub>
</td>
</tr>
<tr>
<td align="center" width="12.5%">
<a href="https://github.com/opencode-ai/opencode"><picture><source media="(prefers-color-scheme: dark)" srcset="https://svgl.app/library/opencode-dark.svg"><img src="https://svgl.app/library/opencode.svg" alt="OpenCode" width="48" height="48"></picture></a><br>
<strong>OpenCode</strong><br>
<sub>Community: hooks + MCP</sub>
</td>
<td align="center" width="12.5%">
<img src="https://placehold.co/48x48/111827/ffffff?text=K" alt="Kiro" width="48" height="48"><br>
<strong>Kiro</strong><br>
<sub>Extended: MCP + hooks</sub>
</td>
<td align="center" width="12.5%">
<img src="https://placehold.co/48x48/111827/ffffff?text=A" alt="Antigravity" width="48" height="48"><br>
<strong>Antigravity</strong><br>
<sub>Community: MCP</sub>
</td>
<td align="center" width="12.5%">
<img src="https://placehold.co/48x48/111827/ffffff?text=T" alt="Trae" width="48" height="48"><br>
<strong>Trae</strong><br>
<sub>Community: MCP</sub>
</td>
<td align="center" width="12.5%">
<img src="https://raw.githubusercontent.com/AVIDS2/memorix/main/assets/logo.png" alt="memcode" width="48" height="48"><br>
<strong>memcode</strong><br>
<sub>First-party memagent</sub>
</td>
<td align="center" width="12.5%">
<img src="https://placehold.co/48x48/111827/ffffff?text=M" alt="Any MCP Client" width="48" height="48"><br>
<strong>Any MCP Client</strong><br>
<sub>stdio or HTTP MCP</sub>
</td>
</tr>
</table>

支持层级：

| 层级 | 含义 |
| --- | --- |
| Core | 测试过的 MCP 路径，并有一等 rules 或 hooks |
| Extended | 支持接入，但有客户端平台限制 |
| Community | 通过 MCP 或 hook adapter 尽力兼容 |
| First-party | 本仓库内置，用来原生使用和验证 Memorix 记忆层 |

## 安装

要求：

- Node.js `>=22.19.0`
- Git，因为项目身份来自真实 Git root

安装并初始化：

```bash
npm install -g memorix
cd your-git-repo
memorix init
```

`memorix init` 创建或更新 TOML 配置：

- `~/.memorix/config.toml`：全局默认配置
- `<git-root>/memorix.toml`：可选项目覆盖配置

旧的 `memorix.yml`、`.env` 和 `~/.memorix/config.json` 仍兼容读取，但新文档和新初始化流程都以 TOML 为准。

## 快速开始

### 给现有 Agent 加记忆

通用 stdio MCP：

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

通用 HTTP MCP：

```bash
memorix background start
```

然后让客户端连接：

```text
http://localhost:3211/mcp
```

HTTP 模式下，如果客户端能提供工作区路径，Agent 应使用 `memorix_session_start(projectRoot=...)` 显式绑定当前仓库。最终项目身份仍以 Git 为准。

### 从 CLI 管理记忆

```bash
memorix memory search --query "release blocker"
memorix reasoning search --query "why sqlite"
memorix git-hook --force
memorix ingest log --count 20
memorix dashboard
```

### 使用 first-party memagent

```bash
memorix
# 或
memcode
```

这会打开 memcode：一个内置终端 memagent，可以直接使用 Claude Code、Codex、Cursor、Windsurf 等 Agent 共享的同一套 Memorix 项目记忆。

## 记忆模型

| 层 | 存什么 | 适合回答 |
| --- | --- | --- |
| Observation Memory | 事实、坑点、修复、实现说明 | “这里是怎么工作的？” |
| Reasoning Memory | 原因、替代方案、约束、风险 | “当时为什么这么选？” |
| Git Memory | 从 commit 提炼出的工程事实 | “最近改了什么，在哪些文件？” |

默认搜索当前项目。`scope="global"` 可以跨项目搜索。“改了什么”会偏向 Git Memory，“为什么”会偏向 reasoning / decision 记录。

## 运行模式

| 你想做什么 | 运行 |
| --- | --- |
| 让 IDE 或 Agent 通过 stdio MCP 共享记忆 | `memorix serve` |
| 启动共享 HTTP MCP 和 Dashboard | `memorix background start` |
| 前台调试 HTTP MCP | `memorix serve-http --port 3211` |
| 直接检查或管理记忆 | `memorix memory`、`memorix reasoning`、`memorix session`、`memorix ingest` |
| 使用内置 first-party memagent | `memorix` 或 `memcode` |
| 运行自主多 Agent 工作 | `memorix orchestrate --goal "..."` |

## memcode：First-Party Memagent

memcode 的存在，是为了让 Memorix 可以原生使用自己的记忆层，也给用户一个不会浪费已沉淀记忆的终端 Agent。

它能读文件、改代码、运行命令、恢复 session、切模型，并暴露 `/memory` 命令。它写入的是同一个 Memorix 项目记忆池，Claude Code、Codex、Cursor、Windsurf 等 MCP Agent 也可以继续使用这些记忆。

```text
one Git project -> one shared Memorix memory pool
```

memcode 专门说明见 [docs/MEMCODE.md](docs/MEMCODE.md)。

## 配置

最小 `~/.memorix/config.toml`：

```toml
[memory.llm]
provider = "openai"
model = "gpt-4o-mini"
api_key = "..."

[embedding]
provider = "auto"

[memory]
inject = "minimal"
formation = "active"

[agent]
provider = "openai"
model = "gpt-4o"
api_key = "..."
```

`[memory.llm]` 和 `[embedding]` 服务于 Memorix 的记忆质量和检索；`[agent]` 只服务于 memcode 或其他 first-party agent 流程。凭据放全局配置或环境变量，不要提交 secrets。

## Docker

Docker 面向 HTTP control plane，不是 stdio MCP：

```bash
docker compose up --build -d
```

启动后：

- Dashboard：`http://localhost:3211`
- MCP：`http://localhost:3211/mcp`
- Health：`http://localhost:3211/health`

如果要使用项目级 Git / 配置语义，容器必须能看到传给 `projectRoot` 的仓库路径。

## SDK

在 TypeScript 中直接使用 Memorix：

```ts
import { createMemoryClient } from 'memorix/sdk';

const client = await createMemoryClient({ projectRoot: '/path/to/repo' });

await client.store({
  entityName: 'auth-module',
  type: 'decision',
  title: 'Use JWT for API auth',
  narrative: 'Chose JWT because the API is stateless and used by multiple clients.',
});

const results = await client.search({ query: 'auth decision' });
await client.close();
```

## 1.1 线更新重点

- **TOML-first 配置**：用户面对的是 `~/.memorix/config.toml` 和项目 `memorix.toml`。
- **模型 lane 分离**：记忆整理、embedding、first-party agent 流程可以使用不同 provider。
- **memcode 作为 first-party memagent**：内置终端 Agent 可以直接使用并反哺 Memorix 项目记忆。
- **发布路径加固**：修复 packaged memcode resolution、SQLite ESM loader、resume/session UI、CLI 测试隔离和 CI release gate。

## 文档

| 从这里开始 | 适合场景 |
| --- | --- |
| [文档地图](docs/README.md) | 快速找到正确文档 |
| [安装与接入](docs/SETUP.md) | 安装、stdio vs HTTP、配置 IDE |
| [配置指南](docs/CONFIGURATION.md) | TOML 配置、模型 lane、兼容文件 |
| [API 参考](docs/API_REFERENCE.md) | MCP 工具和 operator CLI |
| [Git Memory](docs/GIT_MEMORY.md) | commit 摄入和工程事实检索 |
| [Docker](docs/DOCKER.md) | 容器化 HTTP control plane |
| [memcode](docs/MEMCODE.md) | 使用内置 first-party memagent |
| [Agent Operator Playbook](docs/AGENT_OPERATOR_PLAYBOOK.md) | 面向 AI Agent 的安装、绑定、hooks、排障手册 |
| [开发指南](docs/DEVELOPMENT.md) | 贡献、测试、发布检查 |

LLM 友好摘要：[llms.txt](llms.txt) 和 [llms-full.txt](llms-full.txt)。

## 开发

```bash
git clone https://github.com/AVIDS2/memorix.git
cd memorix
npm install
npm run lint
npm test
npm run build
```

## 鸣谢

Memorix 借鉴了 MCP 生态和 mcp-memory-service、MemCP、claude-mem、Mem0 等记忆项目的思路。memcode 基于 Pi coding-agent codebase，并将其终端 Agent 模型适配到 Memorix 生态。

## License

[Apache 2.0](LICENSE)
