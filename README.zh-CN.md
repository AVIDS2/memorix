<p align="center">
  <img src="assets/logo.png" alt="Memorix Logo" width="120">
  <h1 align="center">Memorix</h1>
  <p align="center"><strong>跨 Agent 记忆桥梁 — 让你的 AI 再也不会忘记</strong></p>
  <p align="center">中文文档 | <a href="README.md">English</a></p>
  <p align="center">
    <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/v/memorix.svg?style=flat-square&color=cb3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/memorix"><img src="https://img.shields.io/npm/dm/memorix.svg?style=flat-square&color=blue" alt="npm downloads"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green.svg?style=flat-square" alt="License"></a>
    <a href="https://github.com/AVIDS2/memorix"><img src="https://img.shields.io/github/stars/AVIDS2/memorix?style=flat-square&color=yellow" alt="GitHub stars"></a>
    <img src="https://img.shields.io/badge/tests-509%20passed-brightgreen?style=flat-square" alt="Tests">
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/Works%20with-Cursor-orange?style=flat-square" alt="Cursor">
    <img src="https://img.shields.io/badge/Works%20with-Windsurf-blue?style=flat-square" alt="Windsurf">
    <img src="https://img.shields.io/badge/Works%20with-Claude%20Code-purple?style=flat-square" alt="Claude Code">
    <img src="https://img.shields.io/badge/Works%20with-Codex-green?style=flat-square" alt="Codex">
    <img src="https://img.shields.io/badge/Works%20with-Copilot-lightblue?style=flat-square" alt="Copilot">
    <img src="https://img.shields.io/badge/Works%20with-Kiro-red?style=flat-square" alt="Kiro">
    <img src="https://img.shields.io/badge/Works%20with-Antigravity-grey?style=flat-square" alt="Antigravity">
    <img src="https://img.shields.io/badge/Works%20with-Gemini%20CLI-4285F4?style=flat-square" alt="Gemini CLI">
  </p>
  <p align="center">
    <a href="#-别再反复解释你的项目了">痛点</a> •
    <a href="#-30-秒快速开始">快速开始</a> •
    <a href="#-真实使用场景">场景</a> •
    <a href="#-memorix-能做什么">功能</a> •
    <a href="#-与同类工具对比">对比</a> •
    <a href="docs/SETUP.md">完整配置指南</a>
  </p>
</p>

---

## 😤 别再反复解释你的项目了

你的 AI 助手每次新对话都会忘记一切。你要花 10 分钟重新解释架构。**又一次。** 如果从 Cursor 切到 Claude Code？所有上下文全部丢失。**又一次。**

| 没有 Memorix | 有 Memorix |
|-------------|-----------|
| **第 2 次对话：** "我们的技术栈是什么？" | **第 2 次对话：** "我记得——Next.js + Prisma + tRPC。接下来做什么？" |
| **切换 IDE：** 全部上下文丢失 | **切换 IDE：** 上下文立即跟随 |
| **新同事的 AI：** 从零开始 | **新同事的 AI：** 已了解整个代码库 |
| **50 次工具调用后：** 上下文爆炸，需要重开 | **重开后：** 无缝恢复到上次状态 |
| **MCP 配置：** 在 8 个 IDE 之间手动复制粘贴 | **MCP 配置：** 一条命令全部同步 |

**Memorix 解决所有这些问题。** 一个 MCP 服务器。八个 Agent。零上下文丢失。

---

## ⚡ 30 秒快速开始

### 第一步：全局安装（只需一次）

```bash
npm install -g memorix
```

> ⚠️ **不要用 `npx`** — npx 每次都会重新下载包，会导致 MCP 服务器初始化超时（60 秒限制）。全局安装后秒启动。

### 第二步：添加到你的 Agent 的 MCP 配置

<details open>
<summary><strong>Claude Code</strong></summary>

在终端执行：
```bash
claude mcp add memorix -- memorix serve
```
或手动添加到 `~/.claude.json`：
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
<summary><strong>Cursor</strong></summary>

添加到项目目录的 `.cursor/mcp.json`：
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
<summary><strong>Windsurf</strong></summary>

添加到 Windsurf MCP 配置（`~/.codeium/windsurf/mcp_config.json`）：
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
<summary><strong>VS Code Copilot / Codex / Kiro</strong></summary>

同样的格式 — 添加到对应 Agent 的 MCP 配置文件：
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
<summary><strong>Antigravity / Gemini CLI</strong></summary>

添加到 `.gemini/settings.json`（项目级）或 `~/.gemini/settings.json`（全局）：
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

**仅 Antigravity IDE：** Antigravity 使用自身安装路径作为工作目录，**必须**添加：
```json
{
  "mcpServers": {
    "memorix": {
      "command": "memorix",
      "args": ["serve"],
      "env": {
        "MEMORIX_PROJECT_ROOT": "E:/your/project/path"
      }
    }
  }
}
```

**Gemini CLI** 读取相同路径的 MCP 配置。Hooks 会自动安装到 `.gemini/settings.json`。
</details>

### 第三步：重启你的 Agent — 完成！

不需要 API Key，不需要云账号，不需要额外依赖。**任何目录都能用**（有没有 git 都行）。

> 📖 **8 个 Agent 的完整配置指南** → [docs/SETUP.md](docs/SETUP.md)

<details>
<summary><strong>🔧 常见问题</strong></summary>

| 问题 | 解决方案 |
|------|----------|
| `MCP server initialization timed out after 60 seconds` | 你在用 `npx`。执行 `npm install -g memorix`，然后把配置改成 `"command": "memorix"` |
| `Cannot start Memorix: no valid project detected` | 你的工作目录是系统目录（主目录、桌面等）。打开一个真正的项目文件夹，或设置 `MEMORIX_PROJECT_ROOT` |
| `memorix: command not found` | 先执行 `npm install -g memorix`，用 `memorix --version` 验证 |
| 参数类型错误（GLM/非 Anthropic 模型） | 更新到 v0.9.1+：`npm install -g memorix@latest` |

</details>

---

## 🎬 真实使用场景

### 场景 1：跨会话记忆

```
周一早上 — 你和 Cursor 讨论认证架构：
  你: "用 JWT + refresh token，15 分钟过期"
  → Memorix 自动存储为 🟤 决策

周二 — 新的 Cursor 会话：
  你: "添加登录接口"
  → AI 调用 memorix_search("auth") → 找到周一的决策
  → "好的，我按之前的决策用 JWT + 15 分钟 refresh token 来实现"
  → 零重复解释！
```

### 场景 2：跨 Agent 协作

```
你用 Windsurf 写后端，用 Claude Code 做代码审查：

  Windsurf: 你修复了支付模块的一个竞态条件
  → Memorix 存储为 🟡 问题-解决方案，包含修复细节

  Claude Code: "审查支付模块"
  → AI 调用 memorix_search("payment") → 找到竞态条件修复
  → "我看到最近有个竞态条件修复，让我确认一下是否正确..."
  → 知识在 Agent 之间无缝流转！
```

### 场景 3：踩坑预防

```
第 1 周: 你遇到一个 Windows 路径分隔符 bug
  → Memorix 存储为 🔴 gotcha："用 path.join()，永远不要字符串拼接"

第 3 周: AI 正要写 `baseDir + '/' + filename`
  → 会话启动 hook 已将 gotcha 注入到上下文中
  → AI 改写为 `path.join(baseDir, filename)`
  → bug 在发生前就被阻止了！
```

### 场景 4：跨 IDE 工作区同步

```
你在 Cursor 里配置了 12 个 MCP 服务器。
现在想试试 Kiro。

  你: "把我的工作区同步到 Kiro"
  → memorix_workspace_sync 扫描 Cursor 的 MCP 配置
  → 生成 Kiro 兼容的 .kiro/settings/mcp.json
  → 同时同步你的规则、技能和工作流
  → Kiro 几秒内就绑定好了，不用花几个小时！
```

### 场景 5：自动生成项目技能

```
开发两周后，你有了 50+ 条观察记录：
  - 8 个关于 Windows 路径问题的 gotcha
  - 5 个关于认证模块的决策
  - 3 个数据库迁移的问题-解决方案

  你: "生成项目技能"
  → memorix_skills 按实体聚类观察记录
  → 自动生成 SKILL.md 文件：
    - "auth-module-guide.md" — JWT 设置、刷新流程、常见陷阱
    - "database-migrations.md" — Prisma 模式、回滚策略
  → 同步技能到任何 Agent：Cursor、Claude Code、Kiro...
  → 新同事的 AI 立即掌握你项目的最佳实践！
```

### 场景 6：会话生命周期（v0.8.0）

```
早上 — 在 Windsurf 中开始新会话：
  → memorix_session_start 自动注入：
    📋 上次会话: "实现了 JWT 认证中间件"
    🔴 JWT token 静默过期（踩坑）
    🟤 使用 Docker 部署（决策）
  → AI 立即知道你昨天做了什么！

晚上 — 结束会话：
  → memorix_session_end 保存结构化摘要
  → 下次会话（任何 Agent！）自动获取这些上下文
```

### 场景 7：Topic Key 去重 — 不再有重复记忆（v0.8.0）

```
你在一周内更新了 3 次架构决策：

  第 1 天: memorix_store(topicKey="architecture/auth-model", ...)
  → 创建观察记录 #42（rev 1）

  第 3 天: memorix_store(topicKey="architecture/auth-model", ...)
  → 原地更新 #42（rev 2）— 不是新建 #43！

  第 5 天: memorix_store(topicKey="architecture/auth-model", ...)
  → 再次更新 #42（rev 3）

  结果：1 条记录包含最新内容，而不是 3 条重复！
```

---

## 🧠 Memorix 能做什么

### 智能记忆（24 个 MCP 工具）

| 你说的 | Memorix 做的 |
|--------|-------------|
| "记住这个架构决策" | `memorix_store` — 分类为 🟤 决策，提取实体，创建图关系，自动关联会话 |
| "我们之前关于认证决定了什么？" | `memorix_search` → `memorix_detail` — 3 层渐进式展示，节省约 10 倍 token |
| "上周关于认证的决策？" | `memorix_search` + `since`/`until` — 时序查询，按日期范围过滤 |
| "那个 bug 修复前后发生了什么？" | `memorix_timeline` — 按时间显示前后上下文 |
| "显示知识图谱" | `memorix_dashboard` — 打开交互式 Web UI，含 D3.js 图谱 + 会话面板 |
| "哪些记忆快过期了？" | `memorix_retention` — 指数衰减评分，识别归档候选 |
| "开始新会话" | `memorix_session_start` — 跟踪会话生命周期，自动注入上次会话摘要 + 关键记忆 |
| "结束这次会话" | `memorix_session_end` — 保存结构化摘要（目标/发现/完成/文件），供下次会话使用 |
| "上次我们做了什么？" | `memorix_session_context` — 检索会话历史和关键观察记录 |
| "给这个建议一个 topic key" | `memorix_suggest_topic_key` — 生成稳定的去重键（如 `architecture/auth-model`） |
| "清理重复记忆" | `memorix_consolidate` — 按文本相似度查找并合并相似观察记录，保留所有事实 |
| "导出这个项目的记忆" | `memorix_export` — JSON（可导入）或 Markdown（人类可读，适合 PR/文档） |
| "导入队友的记忆" | `memorix_import` — 从 JSON 导出恢复，重新分配 ID，按 topicKey 去重 |

### 跨 Agent 工作区同步

| 你说的 | Memorix 做的 |
|--------|-------------|
| "把 MCP 服务器同步到 Kiro" | `memorix_workspace_sync` — 迁移配置，合并（永不覆盖） |
| "检查我的 Agent 规则" | `memorix_rules_sync` — 扫描 7 个 Agent，去重，检测冲突 |
| "为 Cursor 生成规则" | `memorix_rules_sync` — 跨格式转换（`.mdc` ↔ `CLAUDE.md` ↔ `.kiro/steering/`） |
| "生成项目技能" | `memorix_skills` — 从观察模式创建 SKILL.md |
| "注入认证技能" | `memorix_skills` — 将技能内容直接返回到 Agent 上下文 |

### 知识图谱（兼容 MCP 官方接口）

| 工具 | 功能 |
|------|-----|
| `create_entities` | 构建项目知识图谱 |
| `create_relations` | 用类型化边连接实体（causes、fixes、depends_on） |
| `add_observations` | 将观察附加到实体 |
| `search_nodes` / `open_nodes` | 查询图谱 |
| `read_graph` | 导出完整图谱用于可视化 |

> **即插即用**，兼容 [MCP 官方 Memory Server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) — 相同 API，更多功能。

### 9 种观察类型

每条记忆都有分类标签，用于智能检索：

| 图标 | 类型 | 使用场景 |
|------|------|---------|
| 🎯 | `session-request` | 本次会话的原始任务/目标 |
| 🔴 | `gotcha` | 关键陷阱 — "永远不要做 X，因为 Y" |
| 🟡 | `problem-solution` | bug 修复，含根因和解决方案 |
| 🔵 | `how-it-works` | 系统的技术解释 |
| 🟢 | `what-changed` | 代码/配置变更记录 |
| 🟣 | `discovery` | 新的洞见或发现 |
| 🟠 | `why-it-exists` | 设计选择背后的原因 |
| 🟤 | `decision` | 架构/设计决策 |
| ⚖️ | `trade-off` | 取舍权衡，含利弊分析 |

### 可视化 Dashboard

运行 `memorix_dashboard` 在 `http://localhost:3210` 打开 Web UI：

- **交互式知识图谱** — D3.js 力导向图，可视化实体和关系
- **观察浏览器** — 按类型筛选，高亮搜索，展开/折叠详情
- **记忆衰减面板** — 查看哪些记忆活跃、过期或待归档
- **项目切换器** — 无需切换 IDE 即可查看任何项目的数据
- **批量清理** — 自动检测并批量删除低质量观察
- **明暗主题** — 玻璃拟态设计，中英双语界面

### 自动记忆 Hook

Memorix 可以**自动捕获**编码会话中的决策、错误和踩坑经验：

```bash
memorix hooks install    # 一条命令安装
```

- **隐式记忆** — 检测 "I decided to..."、"bug 是因为..."、"永远不要用 X" 等模式
- **会话启动注入** — 自动将近期高价值记忆加载到 Agent 上下文
- **多语言** — 支持英文 + 中文关键词匹配
- **智能过滤** — 30 秒冷却，跳过无关命令（ls、cat、pwd）

---

## 📊 与同类工具对比

| | [Mem0](https://github.com/mem0ai/mem0) | [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | [claude-mem](https://github.com/anthropics/claude-code) | **Memorix** |
|---|---|---|---|---|
| **支持的 Agent** | SDK 集成 | 13+（MCP） | 仅 Claude Code | **7 个 IDE（MCP）** |
| **跨 Agent 同步** | 否 | 否 | 否 | **是（配置、规则、技能、工作流）** |
| **规则同步** | 否 | 否 | 否 | **是（7 种格式）** |
| **技能引擎** | 否 | 否 | 否 | **是（从记忆自动生成）** |
| **知识图谱** | 否 | 是 | 否 | **是（兼容 MCP 官方）** |
| **混合搜索** | 否 | 是 | 否 | **是（BM25 + 向量）** |
| **Token 高效** | 否 | 否 | 是（3 层） | **是（3 层渐进式展示）** |
| **自动记忆 Hook** | 否 | 否 | 是 | **是（多语言）** |
| **记忆衰减** | 否 | 是 | 否 | **是（指数衰减 + 豁免）** |
| **可视化面板** | 云端 UI | 是 | 否 | **是（Web UI + D3.js 图谱）** |
| **隐私** | 云端 | 本地 | 本地 | **100% 本地** |
| **费用** | 按量付费 | $0 | $0 | **$0** |
| **安装** | `pip install` | `pip install` | 内置于 Claude | **`npx memorix serve`** |

**Memorix 是唯一同时桥接记忆和工作区跨 Agent 共享的工具。**

---

## 🔮 可选：向量搜索

开箱即用，Memorix 使用 BM25 全文搜索（对代码已经足够好）。一条命令添加语义搜索：

```bash
# 方案 A：原生速度（推荐）
npm install -g fastembed

# 方案 B：通用兼容
npm install -g @huggingface/transformers
```

有了向量搜索，"authentication" 这样的查询也能匹配到关于 "login flow" 的记忆。两种方案都 **100% 本地运行** — 零 API 调用，零费用。

---

## 🔒 项目隔离

- **自动检测** — 通过 `git remote` URL 识别项目，零配置
- **MCP roots 回退** — 如果 `cwd` 不是项目目录（如 Antigravity），Memorix 会尝试 [MCP roots 协议](https://modelcontextprotocol.io/docs/concepts/roots) 从 IDE 获取工作区路径
- **按项目存储** — `~/.memorix/data/<owner--repo>/` 每个项目独立
- **作用域搜索** — 默认搜索当前项目；`scope: "global"` 搜索所有项目
- **零交叉污染** — 项目 A 的决策永远不会泄漏到项目 B

**检测优先级：** `--cwd` → `MEMORIX_PROJECT_ROOT` → `INIT_CWD` → `process.cwd()` → MCP roots → 报错

---

## ❓ 常见问题

**在 Cursor 和 Claude Code 之间切换时如何保持上下文？**
在两个 IDE 都安装 Memorix。它们共享相同的本地记忆目录 — 在 Cursor 中做的架构决策在 Claude Code 中立即可搜索，无需云同步。

**如何防止 AI 忘记之前的会话？**
在每次会话开始时调用 `memorix_session_start` — 它会自动注入上次会话的摘要和关键观察记录（踩坑、决策、发现）。会话结束时调用 `memorix_session_end` 保存结构化摘要。所有观察记录持久存储在磁盘上，随时可通过 `memorix_search` 搜索。

**如何在 IDE 之间同步 MCP 服务器配置？**
运行 `memorix_workspace_sync`，设置 action 为 `"migrate"`，指定目标 IDE。它会扫描源配置并生成兼容的目标配置 — 合并，永不覆盖。

**如何从 Cursor 迁移到 Windsurf / Kiro / Claude Code？**
Memorix 工作区同步可以迁移 MCP 配置、Agent 规则（`.mdc` ↔ `CLAUDE.md` ↔ `.kiro/steering/`）、技能和工作流。一条命令，几秒完成。

**有没有用于持久 AI 编码记忆的 MCP 服务器？**
有 — Memorix 是一个跨 Agent 记忆 MCP 服务器，支持 7 个 IDE，提供知识图谱、3 层渐进式搜索、工作区同步和自动生成项目技能。

**和 mcp-memory-service 有什么区别？**
两个都是优秀的记忆服务器。Memorix 额外提供：跨 Agent 工作区同步（MCP 配置、规则、技能）、从记忆模式自动生成项目技能、3 层 token 高效搜索、会话启动记忆注入 Hook。

**支持离线/本地运行吗？**
完全支持。所有数据存储在 `~/.memorix/data/`。无云端，无 API Key，无外部服务。可选的向量搜索也通过 ONNX/WASM 本地运行。

> 📖 AI 系统参考：查看 [`llms.txt`](llms.txt) 和 [`llms-full.txt`](llms-full.txt) 获取机器可读的项目文档。

---

## 🧑‍💻 开发

```bash
git clone https://github.com/AVIDS2/memorix.git
cd memorix
npm install

npm run dev          # tsup 监听模式
npm test             # vitest（422 个测试）
npm run lint         # TypeScript 类型检查
npm run build        # 生产构建
```

> 📚 **文档：** [架构设计](docs/ARCHITECTURE.md) • [API 参考](docs/API_REFERENCE.md) • [模块说明](docs/MODULES.md) • [设计决策](docs/DESIGN_DECISIONS.md) • [配置指南](docs/SETUP.md) • [已知问题与路线图](docs/KNOWN_ISSUES_AND_ROADMAP.md)

---

## 🙏 致谢

Memorix 站在这些优秀项目的肩膀上：

- [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) — 混合搜索、指数衰减、访问追踪
- [MemCP](https://github.com/maydali28/memcp) — MAGMA 四图、实体提取、保留生命周期
- [claude-mem](https://github.com/anthropics/claude-code) — 3 层渐进式展示
- [Mem0](https://github.com/mem0ai/mem0) — 记忆层架构模式

---

## 📄 许可证

Apache 2.0 — 详见 [LICENSE](LICENSE)

---

<p align="center">
  <strong>Made with ❤️ by <a href="https://github.com/AVIDS2">AVIDS2</a></strong>
  <br>
  <sub>如果 Memorix 对你有帮助，欢迎在 GitHub 上给个 ⭐！</sub>
</p>
