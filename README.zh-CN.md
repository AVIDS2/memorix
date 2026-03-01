<p align="center">
  <img src="assets/logo.png" alt="Memorix" width="120">
</p>

<h1 align="center">Memorix</h1>

<p align="center">
  <strong>AI 编码 Agent 的持久化记忆层</strong><br>
  一个 MCP 服务器，八个 Agent，零上下文丢失。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/v/memorix.svg?style=flat-square&color=cb3837" alt="npm"></a>
  <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/dm/memorix.svg?style=flat-square&color=blue" alt="downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green.svg?style=flat-square" alt="license"></a>
  <a href="https://github.com/AVIDS2/memorix"><img src="https://img.shields.io/github/stars/AVIDS2/memorix?style=flat-square&color=yellow" alt="stars"></a>
  <img src="https://img.shields.io/badge/tests-534%20passed-brightgreen?style=flat-square" alt="tests">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/-Cursor-orange?style=flat-square" alt="Cursor">
  <img src="https://img.shields.io/badge/-Windsurf-blue?style=flat-square" alt="Windsurf">
  <img src="https://img.shields.io/badge/-Claude%20Code-purple?style=flat-square" alt="Claude Code">
  <img src="https://img.shields.io/badge/-Codex-green?style=flat-square" alt="Codex">
  <img src="https://img.shields.io/badge/-Copilot-lightblue?style=flat-square" alt="Copilot">
  <img src="https://img.shields.io/badge/-Kiro-red?style=flat-square" alt="Kiro">
  <img src="https://img.shields.io/badge/-OpenCode-teal?style=flat-square" alt="OpenCode">
  <img src="https://img.shields.io/badge/-Gemini%20CLI-4285F4?style=flat-square" alt="Gemini CLI">
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#功能">功能</a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="docs/SETUP.md">完整配置指南</a>
</p>

---

## 为什么选择 Memorix？

AI 编码 Agent 在会话之间会忘记一切。切换 IDE 后上下文全部丢失。Memorix 为每个 Agent 提供共享的持久化记忆——决策、踩坑和架构跨会话、跨工具长期保留。

```
会话 1（Cursor）：  "用 JWT + refresh token，15 分钟过期"  → 存储为 🟤 决策
会话 2（Claude Code）：  "添加登录接口"  → 找到该决策 → 正确实现
```

无需重复解释。无需复制粘贴。无厂商锁定。

---

## 快速开始

```bash
npm install -g memorix
```

添加到 Agent 的 MCP 配置：

<details open>
<summary><strong>Cursor</strong> · <code>.cursor/mcp.json</code></summary>

```json
{ "mcpServers": { "memorix": { "command": "memorix", "args": ["serve"] } } }
```
</details>

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add memorix -- memorix serve
```
</details>

<details>
<summary><strong>Windsurf</strong> · <code>~/.codeium/windsurf/mcp_config.json</code></summary>

```json
{ "mcpServers": { "memorix": { "command": "memorix", "args": ["serve"] } } }
```
</details>

<details>
<summary><strong>VS Code Copilot</strong> · <code>.vscode/mcp.json</code></summary>

```json
{ "servers": { "memorix": { "command": "memorix", "args": ["serve"] } } }
```
</details>

<details>
<summary><strong>Codex</strong> · <code>~/.codex/config.toml</code></summary>

```toml
[mcp_servers.memorix]
command = "memorix"
args = ["serve"]
```
</details>

<details>
<summary><strong>Kiro</strong> · <code>.kiro/settings/mcp.json</code></summary>

```json
{ "mcpServers": { "memorix": { "command": "memorix", "args": ["serve"] } } }
```
</details>

<details>
<summary><strong>OpenCode</strong> · <code>~/.config/opencode/config.json</code></summary>

```json
{ "mcpServers": { "memorix": { "command": "memorix", "args": ["serve"] } } }
```
</details>

<details>
<summary><strong>Gemini CLI</strong> · <code>.gemini/settings.json</code></summary>

```json
{ "mcpServers": { "memorix": { "command": "memorix", "args": ["serve"] } } }
```
</details>

重启 Agent 即可。无需 API Key，无需云服务，无需额外依赖。

> **注意：** 不要用 `npx`——它每次都会重新下载，导致 MCP 超时。请用全局安装。
>
> 📖 [完整配置指南](docs/SETUP.md) · [常见问题排查](docs/SETUP.md#troubleshooting)

---

## 功能

### 25 个 MCP 工具

| | |
|---|---|
| **记忆** | `memorix_store` · `memorix_search` · `memorix_detail` · `memorix_timeline` — 3 层渐进式展示，节省约 10 倍 token |
| **会话** | `memorix_session_start` · `memorix_session_end` · `memorix_session_context` — 新会话自动注入上次上下文 |
| **知识图谱** | `create_entities` · `create_relations` · `add_observations` · `search_nodes` · `open_nodes` · `read_graph` — 兼容 [MCP 官方 Memory Server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) |
| **工作区同步** | `memorix_workspace_sync` · `memorix_rules_sync` · `memorix_skills` — 跨 8 个 Agent 迁移 MCP 配置、规则和技能 |
| **维护** | `memorix_retention` · `memorix_consolidate` · `memorix_export` · `memorix_import` — 衰减评分、去重、备份 |
| **仪表盘** | `memorix_dashboard` — Web UI，D3.js 知识图谱、观察浏览器、衰减面板 |

### 9 种观察类型

🎯 session-request · 🔴 gotcha · 🟡 problem-solution · 🔵 how-it-works · 🟢 what-changed · 🟣 discovery · 🟠 why-it-exists · 🟤 decision · ⚖️ trade-off

### 自动记忆 Hook

```bash
memorix hooks install
```

自动捕获决策、错误和踩坑经验。中英文模式检测。智能过滤（30 秒冷却，跳过无关命令）。会话启动时自动注入高价值记忆。

### 混合搜索

开箱即用 BM25 全文搜索。一条命令添加语义搜索：

```bash
npm install -g @huggingface/transformers   # 或: npm install -g fastembed
```

100% 本地运行，零 API 调用。

---

## 工作原理

```
┌─────────┐  ┌───────────┐  ┌────────────┐  ┌───────┐  ┌──────────┐
│ Cursor  │  │ Claude    │  │ Windsurf   │  │ Codex │  │ +4 more  │
│         │  │ Code      │  │            │  │       │  │          │
└────┬────┘  └─────┬─────┘  └─────┬──────┘  └───┬───┘  └────┬─────┘
     │             │              │              │           │
     └─────────────┴──────┬───────┴──────────────┴───────────┘
                          │ MCP (stdio)
                   ┌──────┴──────┐
                   │   Memorix   │
                   │  MCP Server │
                   └──────┬──────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
   ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐
   │   Orama     │ │  Knowledge  │ │  Rules &    │
   │ Search      │ │  Graph      │ │  Workspace  │
   │ (BM25+Vec)  │ │  (Entities) │ │  Sync       │
   └─────────────┘ └─────────────┘ └─────────────┘
                          │
                   ~/.memorix/data/
                   (100% 本地，按项目隔离)
```

- **项目隔离** — 通过 `git remote` 自动检测，默认按项目搜索
- **共享存储** — 所有 Agent 读写同一个 `~/.memorix/data/`，天然跨 IDE
- **Token 高效** — 3 层渐进式展示：search → timeline → detail

---

## 对比

| | [Mem0](https://github.com/mem0ai/mem0) | [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | **Memorix** |
|---|---|---|---|
| **Agent 支持** | SDK 集成 | 13+（MCP） | **8 个 Agent（MCP）** |
| **跨 Agent 工作区同步** | — | — | **MCP 配置、规则、技能、工作流** |
| **知识图谱** | — | 是 | **是（兼容 MCP 官方）** |
| **混合搜索** | — | 是 | **是（BM25 + 向量）** |
| **Token 高效检索** | — | — | **3 层渐进式展示** |
| **自动记忆 Hook** | — | — | **是（多语言模式检测）** |
| **记忆衰减** | — | 是 | **是（指数衰减 + 豁免）** |
| **Web 仪表盘** | 云端 | 是 | **是（D3.js 图谱）** |
| **隐私** | 云端 | 本地 | **100% 本地** |
| **费用** | 按量付费 | $0 | **$0** |

---

## 开发

```bash
git clone https://github.com/AVIDS2/memorix.git
cd memorix && npm install

npm run dev       # 监听模式
npm test          # 534 个测试
npm run build     # 生产构建
```

📚 [架构设计](docs/ARCHITECTURE.md) · [API 参考](docs/API_REFERENCE.md) · [模块说明](docs/MODULES.md) · [设计决策](docs/DESIGN_DECISIONS.md)

> AI 系统参考：[`llms.txt`](llms.txt) · [`llms-full.txt`](llms-full.txt)

---

## 致谢

参考了 [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service)、[MemCP](https://github.com/maydali28/memcp)、[claude-mem](https://github.com/anthropics/claude-code) 和 [Mem0](https://github.com/mem0ai/mem0) 的设计思路。

## 许可证

[Apache 2.0](LICENSE)

---

<p align="center">
  <sub>Built by <a href="https://github.com/AVIDS2">AVIDS2</a> · 觉得有用请给个 ⭐</sub>
</p>
