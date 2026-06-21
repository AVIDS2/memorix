<p align="center">
  <img src="https://raw.githubusercontent.com/AVIDS2/memorix/main/assets/readme-hero.svg" alt="Memorix" width="720">
</p>

<h1 align="center">Memorix</h1>

<p align="center">
  <strong>面向 AI Coding Agent 的本地优先共享记忆层。</strong><br>
  让 Claude Code、Codex、Cursor、Windsurf、Copilot、Gemini CLI、OpenCode、Pi、Kiro、Antigravity、Trae 和任何 MCP Agent 共用同一套项目记忆。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/v/memorix.svg?style=for-the-badge&logo=npm&color=cb3837" alt="npm"></a>
  <a href="https://github.com/AVIDS2/memorix/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/AVIDS2/memorix/ci.yml?style=for-the-badge&label=CI&logo=github" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-2563eb?style=for-the-badge" alt="license"></a>
  <a href="https://github.com/AVIDS2/memorix"><img src="https://img.shields.io/github/stars/AVIDS2/memorix?style=for-the-badge&logo=github&color=facc15" alt="stars"></a>
</p>

<p align="center">
  <strong>共享项目记忆</strong> | <strong>MCP</strong> | <strong>Git Memory</strong> | <strong>Reasoning Memory</strong> | <strong>插件包</strong> | <strong>编排</strong>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="#安装">安装</a> |
  <a href="#支持你的-agent">Agents</a> |
  <a href="#快速开始">快速开始</a> |
  <a href="#记忆模型">记忆模型</a> |
  <a href="#memcode内置终端-agent">memcode</a> |
  <a href="#文档">文档</a>
</p>

---

<h2 id="memorix-是什么"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-overview.svg"><img src="assets/tags/section-overview.svg" alt="Memorix" height="32" /></picture></h2>

Memorix 给你已经在用的 AI 编程 Agent 加上一套共享、可检索的项目记忆，让它跨越新对话、切换 IDE、重开终端 session 和交接都不丢失。记忆归属于 Git 项目，而不是被锁在某个聊天窗口或某个工具里。

今天用 Claude Code，明天用 Codex，下午切到 Cursor。Agent 可以换，项目记忆不用重来。

**什么时候该用 Memorix：** 当你一遍遍向新 Agent 重新解释同一个项目时：上个 session 已经搞明白的事丢了，另一个 IDE 看不到这边学到的东西，某个设计决策埋在旧聊天里找不到。

| 问题 | Memorix 提供什么 |
| --- | --- |
| 下一个 session 忘了上一个 session 学到的东西 | 项目级记忆、session 摘要、timeline 和 detail 检索 |
| 不同 Agent 各记各的 | 通过 MCP、hooks、CLI、SDK 和内置终端 Agent 共用同一套本地记忆池 |
| Git 记录了改动，但 Agent 很难检索工程事实 | Git Memory 把 commit 转成可搜索的工程记忆 |
| 架构决策散落在旧聊天里 | Reasoning Memory 存储原因、替代方案和 trade-off |
| 静态规则文件容易过期 | 坑点、修复和项目技能从真实工作中持续沉淀 |
| 并行 Agent 工作容易乱 | `memorix orchestrate` 负责协调任务上下文、交接、文件锁、验证和 review 流程 |

Memorix 是本地优先的。SQLite 是权威存储，Orama 负责搜索，LLM 记忆整理和 embedding 是可选能力。没有模型 key 时，Memorix 仍然可以用本地全文检索工作。

<h2 id="支持你的-agent"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-agents.svg"><img src="assets/tags/section-agents.svg" alt="Works with every agent" height="32" /></picture></h2>

Memorix 会通过目标 Agent 已经支持的方式接入：插件包、MCP、项目规则、hooks、skills，或者内置终端 Agent。`memorix setup` 会为每个 Agent 选择合适的接入方式，并默认使用 stdio MCP。

<table>
<tr>
<td align="center" width="12.5%">
<a href="https://claude.com/product/claude-code"><img src="https://github.com/anthropics.png?size=120" alt="Claude Code" width="48" height="48"></a><br>
<strong>Claude Code</strong><br>
<sub>官方插件 + MCP + hooks + skills</sub>
</td>
<td align="center" width="12.5%">
<a href="https://github.com/openai/codex"><img src="https://github.com/openai.png?size=120" alt="Codex CLI" width="48" height="48"></a><br>
<strong>Codex CLI</strong><br>
<sub>官方插件 + MCP + AGENTS.md</sub>
</td>
<td align="center" width="12.5%">
<a href="https://github.com/features/copilot"><img src="https://github.githubassets.com/images/modules/site/copilot/copilot.png" alt="GitHub Copilot CLI" width="48" height="48"></a><br>
<strong>GitHub Copilot CLI</strong><br>
<sub>插件 + MCP + hooks + skills</sub>
</td>
<td align="center" width="12.5%">
<a href="https://cursor.com"><picture><source media="(prefers-color-scheme: dark)" srcset="https://svgl.app/library/cursor_dark.svg"><img src="https://svgl.app/library/cursor_light.svg" alt="Cursor" width="48" height="48"></picture></a><br>
<strong>Cursor</strong><br>
<sub>MCP + rules + skills</sub>
</td>
<td align="center" width="12.5%">
<a href="https://windsurf.com"><picture><source media="(prefers-color-scheme: dark)" srcset="https://svgl.app/library/windsurf-dark.svg"><img src="https://svgl.app/library/windsurf-light.svg" alt="Windsurf" width="48" height="48"></picture></a><br>
<strong>Windsurf</strong><br>
<sub>MCP + rules + hooks</sub>
</td>
<td align="center" width="12.5%">
<a href="https://github.com/google-gemini/gemini-cli"><img src="https://github.com/google-gemini.png?size=120" alt="Gemini CLI" width="48" height="48"></a><br>
<strong>Gemini CLI</strong><br>
<sub>extension + MCP + GEMINI.md</sub>
</td>
</tr>
<tr>
<td align="center" width="12.5%">
<a href="https://github.com/opencode-ai/opencode"><picture><source media="(prefers-color-scheme: dark)" srcset="https://svgl.app/library/opencode-dark.svg"><img src="https://svgl.app/library/opencode.svg" alt="OpenCode" width="48" height="48"></picture></a><br>
<strong>OpenCode</strong><br>
<sub>local plugin + MCP + skills + AGENTS.md</sub>
</td>
<td align="center" width="12.5%">
<a href="https://pi.dev"><img src="https://pi.dev/favicon.svg" alt="pi coding agent" width="48" height="48"></a><br>
<strong>pi coding agent</strong><br>
<sub>package + extension + skill</sub>
</td>
<td align="center" width="12.5%">
<a href="https://kiro.dev"><img src="https://kiro.dev/icon.svg" alt="Kiro" width="48" height="48"></a><br>
<strong>Kiro</strong><br>
<sub>MCP + steering + hooks</sub>
</td>
<td align="center" width="12.5%">
<a href="https://antigravity.google"><img src="https://antigravity.google/favicon.ico" alt="Antigravity" width="48" height="48"></a><br>
<strong>Antigravity</strong><br>
<sub>MCP + GEMINI.md</sub>
</td>
<td align="center" width="12.5%">
<a href="https://www.trae.ai"><img src="https://github.com/Trae-AI.png?size=120" alt="Trae" width="48" height="48"></a><br>
<strong>Trae</strong><br>
<sub>MCP + project rules</sub>
</td>
<td align="center" width="12.5%">
<img src="https://raw.githubusercontent.com/AVIDS2/memorix/main/assets/logo.png" alt="memcode" width="48" height="48"><br>
<strong>memcode</strong><br>
<sub>内置终端 Agent</sub>
</td>
<td align="center" width="12.5%">
<a href="https://modelcontextprotocol.io"><img src="https://github.com/modelcontextprotocol.png?size=120" alt="Any MCP Client" width="48" height="48"></a><br>
<strong>Any MCP Client</strong><br>
<sub>stdio or HTTP MCP</sub>
</td>
</tr>
</table>

<p align="center">
  <sub>支持 MCP、hooks/rules 或插件/包入口的 Agent。所有入口共用同一套本地优先记忆层。</sub>
</p>

接入面：

| 接入面 | 作用 | Memorix 入口 |
| --- | --- | --- |
| Setup 命令 | 一步安装推荐的 Memorix 接入 | `memorix setup --agent <agent>` |
| MCP | 给 Agent 提供搜索、详情检索、写入、reasoning 和协同工具 | setup 包内置，或手动运行 `memorix serve` |
| 项目指令 | 告诉 Agent 什么时候、怎么使用 Memorix，而不是每轮都强制查记忆 | 由 `memorix setup` 打包或生成 |
| Hooks | 在 Agent 支持时捕获有价值的 prompt、tool 事件、文件编辑和 session 生命周期 | 由 `memorix setup` 打包或生成 |
| 插件包 | 给支持插件的 Agent 安装插件文件 | Claude Code、Codex、GitHub Copilot CLI |
| Package / Extension | 给支持 package 或 extension 的 Agent 安装对应文件 | Pi、Gemini CLI |
| 项目插件 | 给直接加载项目插件文件的 Agent 安装插件 | OpenCode |
| MCP / rules 包 | 给支持 MCP、rules、steering、guidance 或 hooks 的 IDE 和 Agent 写入配置 | Cursor、Windsurf、Kiro、Antigravity、Trae |
| Skills | 把沉淀下来的项目知识提升成可复用任务指导 | `memorix skills` 和 `memorix_promote` |
| memcode | 打开已经接好 Memorix 记忆的内置终端 Agent | `memorix` 或 `memcode` |

当前支持矩阵和各类生成文件说明见 [集成形态](docs/INTEGRATIONS.md)。

CLI、MCP 和 HTTP 是不同入口：

- `memorix` CLI 用于直接操作：setup、记忆搜索/写入、Git Memory、导入导出、Dashboard、编排、诊断和自动化。
- `memorix serve` 是给 IDE / Coding Agent 使用的 stdio MCP 桥。
- `memorix background start` / `memorix serve-http` 是 HTTP 服务，用于共享端点、Dashboard、Docker 或多客户端。

<h2 id="安装"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-install.svg"><img src="assets/tags/section-install.svg" alt="安装" height="32" /></picture></h2>

要求：

- Node.js `>=22.19.0`
- Git，因为项目身份来自真实 Git root

安装并初始化：

```bash
npm install -g memorix
cd your-git-repo
memorix init
memorix setup --list
memorix setup --agent claude   # 也可以是 codex、copilot、cursor、pi、gemini-cli 等
```

`memorix init` 创建或更新 TOML 配置：

- `~/.memorix/config.toml`：全局默认配置
- `<git-root>/memorix.toml`：可选项目覆盖配置

旧的 `memorix.yml`、`.env` 和 `~/.memorix/config.json` 仍兼容读取，但新文档和新初始化流程都以 TOML 为准。

<h2 id="快速开始"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-quick-start.svg"><img src="assets/tags/section-quick-start.svg" alt="快速开始" height="32" /></picture></h2>

### 给现有 Agent 加记忆

优先使用 setup 命令。它会为目标 Agent 安装推荐的接入方式：

```bash
memorix setup --agent claude
memorix setup --agent codex
memorix setup --agent copilot
memorix setup --agent cursor
memorix setup --agent pi
memorix setup --agent gemini-cli
memorix setup --agent opencode
```

它会安装：

- Claude Code：本地 marketplace 插件，包含 MCP、hooks 和 skills，并写入 `CLAUDE.md` 使用规范。
- Codex：本地 Personal marketplace 插件，包含 MCP、hooks 和 skills，并写入 `AGENTS.md` 使用规范。
- GitHub Copilot CLI：Copilot CLI 插件包，包含 MCP、hooks 和官方 Memorix skills。
- Pi：项目本地 Pi package，包含 Memorix extension 和官方 skills，并通过 `pi install` 注册。
- Cursor：写入 Cursor 项目配置、rules、skills 和 hook 指引。
- Gemini CLI：extension 包，包含 MCP 和 `GEMINI.md` 上下文。
- OpenCode：本地插件文件、`opencode.json` MCP 配置、OpenCode skills 和 `AGENTS.md` 使用规范。
- Windsurf、Kiro、Antigravity、Trae：按各 Agent 能力生成 MCP/rules/hooks 文件。

如果你的 Agent 只需要手动 MCP 配置，使用 stdio：

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

HTTP 不是普通安装必需项。只有在你明确需要共享后台服务、Dashboard、Docker，或多个客户端共用一个端点时才使用：

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

### 使用内置终端 Agent

```bash
memorix
# 或
memcode
```

这会打开 memcode：一个已经接好 Memorix 记忆的终端 Coding Agent。

<h2 id="记忆模型"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-memory-model.svg"><img src="assets/tags/section-memory-model.svg" alt="记忆模型" height="32" /></picture></h2>

| 层 | 存什么 | 适合回答 |
| --- | --- | --- |
| Observation Memory | 事实、坑点、修复、实现说明 | “这里是怎么工作的？” |
| Reasoning Memory | 原因、替代方案、约束、风险 | “当时为什么这么选？” |
| Git Memory | 从 commit 提炼出的工程事实 | “最近改了什么，在哪些文件？” |

默认搜索当前项目。`scope="global"` 可以跨项目搜索。“改了什么”会偏向 Git Memory，“为什么”会偏向 reasoning / decision 记录。

<h2 id="运行模式"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-runtime.svg"><img src="assets/tags/section-runtime.svg" alt="运行模式" height="32" /></picture></h2>

| 你想做什么 | 运行 |
| --- | --- |
| 安装某个 Agent 的接入包 | `memorix setup --agent <agent>` |
| 手动暴露 stdio MCP | `memorix serve` |
| 启动共享 HTTP MCP 和 Dashboard | `memorix background start` |
| 前台调试 HTTP MCP | `memorix serve-http --port 3211` |
| 直接检查或管理记忆 | `memorix memory`、`memorix reasoning`、`memorix session`、`memorix ingest` |
| 使用内置终端 Agent | `memorix` 或 `memcode` |
| 运行编排式 subagent 工作 | `memorix orchestrate --goal "..."` |

`memorix orchestrate` 单 worker 默认使用当前 checkout；多 worker 时会在 `.worktrees/` 下为任务创建隔离 worktree，并把成功的任务分支 merge 回来。用 `--isolated` 可强制单 worker 也隔离，用 `--no-worktree` 禁用 worktree，用 `--allow-dirty` 允许带未提交改动运行，用 `--no-auto-merge` 保留任务 worktree 方便人工 review。

<h2 id="memcode内置终端-agent"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-memcode.svg"><img src="assets/tags/section-memcode.svg" alt="memcode" height="32" /></picture></h2>

memcode 是 Memorix 内置的终端 Coding Agent。它能读文件、改代码、运行命令、恢复 session、切换模型，并提供 `/memory` 命令；读写的仍然是同一套 Memorix 项目记忆。

想要一个开箱即用、已经带记忆的终端 Agent 时用它。

```text
one Git project -> one shared Memorix memory pool
```

memcode 专门说明见 [docs/MEMCODE.md](docs/MEMCODE.md)。

<h2 id="配置"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-configuration.svg"><img src="assets/tags/section-configuration.svg" alt="配置" height="32" /></picture></h2>

最小 `~/.memorix/config.toml`：

```toml
[agent]
provider = "openai"
model = "gpt-4o"
api_key = "..."

[memory.llm]
provider = "openai"
model = "gpt-4o-mini"
api_key = "..."

[embedding]
provider = "auto"

[memory]
inject = "minimal"
formation = "active"
```

`[memory.llm]` 和 `[embedding]` 服务于 Memorix 的记忆质量和检索；`[agent]` 是 memcode 编码时使用的模型。凭据放全局配置或环境变量，不要提交 secrets。

<h2 id="docker"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-docker.svg"><img src="assets/tags/section-docker.svg" alt="Docker" height="32" /></picture></h2>

Docker 面向 HTTP 服务，不是 stdio MCP：

```bash
docker compose up --build -d
```

启动后：

- Dashboard：`http://localhost:3211`
- MCP：`http://localhost:3211/mcp`
- Health：`http://localhost:3211/health`

如果要使用项目级 Git / 配置语义，容器必须能看到传给 `projectRoot` 的仓库路径。

<h2 id="sdk"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-sdk.svg"><img src="assets/tags/section-sdk.svg" alt="SDK" height="32" /></picture></h2>

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

<h2 id="文档"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-docs.svg"><img src="assets/tags/section-docs.svg" alt="文档" height="32" /></picture></h2>

| 从这里开始 | 适合场景 |
| --- | --- |
| [文档地图](docs/README.md) | 快速找到正确文档 |
| [安装与接入](docs/SETUP.md) | 安装、使用 `memorix setup`、选择 stdio vs HTTP |
| [集成形态](docs/INTEGRATIONS.md) | 插件包、MCP、项目规则、hooks 和 skills 支持 |
| [配置指南](docs/CONFIGURATION.md) | TOML 配置、模型 lane、兼容文件 |
| [API 参考](docs/API_REFERENCE.md) | MCP 工具和 CLI 命令 |
| [Git Memory](docs/GIT_MEMORY.md) | commit 摄入和工程事实检索 |
| [Docker](docs/DOCKER.md) | 容器化 HTTP 服务 |
| [memcode](docs/MEMCODE.md) | 使用内置终端 Agent |
| [Agent Playbook](docs/AGENT_OPERATOR_PLAYBOOK.md) | 面向 AI Agent 的安装、绑定、hooks、排障手册 |
| [开发指南](docs/DEVELOPMENT.md) | 贡献、测试、发布检查 |
| [更新日志](CHANGELOG.md) | 每个版本改了什么 |

LLM 友好摘要：[llms.txt](llms.txt) 和 [llms-full.txt](llms-full.txt)。

<h2 id="开发"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-development.svg"><img src="assets/tags/section-development.svg" alt="开发" height="32" /></picture></h2>

```bash
git clone https://github.com/AVIDS2/memorix.git
cd memorix
npm install
npm run lint
npm test
npm run build
```

<h2 id="鸣谢"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-acknowledgements.svg"><img src="assets/tags/section-acknowledgements.svg" alt="鸣谢" height="32" /></picture></h2>

Memorix 借鉴了 MCP 生态和 mcp-memory-service、MemCP、claude-mem、Mem0 等记忆项目的思路。memcode 基于 Pi coding-agent codebase，并将其终端 Agent 模型适配到 Memorix 生态。

<h2 id="license"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/tags/light/section-license.svg"><img src="assets/tags/section-license.svg" alt="License" height="32" /></picture></h2>

[Apache 2.0](LICENSE)
