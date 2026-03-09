# Memorix AI 协作上下文

> 本文档面向参与 Memorix 开发的 AI 助手 (包括未来可能迁移到的 IDE)。
> 如果你是一个 AI 编码助手，正在首次接触这个项目，请先阅读本文档。

---

## 快速了解

**Memorix** 是一个跨 AI Agent 的持久化记忆层，通过 MCP (Model Context Protocol) 运行。

**一句话**: 让 AI Agent 在会话之间记住上下文，跨 IDE 同步工作环境。

**技术栈**: TypeScript + Orama + MCP SDK + Vitest + tsup

---

## 项目状态 (截至 2026-03-09, v1.0.0)

### 功能完成度
- ✅ 核心记忆存储/搜索/检索
- ✅ 知识图谱 (MCP Official 兼容, 可选启用)
- ✅ 3层渐进式披露 (10x token 节省)
- ✅ 记忆衰减 & 保留 + 自动归档
- ✅ 实体自动抽取 & 关系自动创建
- ✅ Embedding 向量搜索 (API/FastEmbed/Transformers)
- ✅ Hooks 隐式记忆系统 (5 个生命周期 Hook)
- ✅ 跨 Agent 规则同步 (10 个 Agent)
- ✅ 跨 Agent 工作空间迁移
- ✅ Web Dashboard (localhost:3210, 知识图谱/观察/搜索/团队)
- ✅ 会话管理 (自动上下文注入)
- ✅ Mini-Skills (永久技能, 自动注入)
- ✅ LLM 增强模式 (压缩/重排序/去重)
- ✅ 团队协作 (Agent注册/文件锁/任务板/消息)
- ✅ 自动清理 (启动时归档+去重)
- ✅ 导入导出 (JSON + Markdown)
- ✅ 753 测试通过, 56 个测试文件, 零回归

### 代码规模
- 22 个默认 MCP 工具 + 9 个可选知识图谱工具
- 56 个测试文件, 753 个测试用例
- 10 个 IDE 支持

---

## 你需要知道的关键约定

### 1. MCP 协议约束
- **stdout 是 MCP 通信通道** — 所有日志必须输出到 `stderr`
- 工具返回格式: `{ content: [{ type: 'text', text: ... }] }`
- 错误返回格式: `{ content: [...], isError: true }`

### 2. 可选依赖
- `fastembed` 是可选的 — 代码必须在未安装时正常工作
- 使用动态 `import()` 而非静态 `import` 加载可选依赖
- `getEmbeddingProvider()` 返回 `null` 表示不可用

### 3. 错误处理策略
- **Hooks 系统永远不能崩溃** — 所有错误静默处理
- MCP 工具可以返回 `isError: true` 但不应抛出异常
- 可选功能 (embedding, hooks 安装, 同步建议) 失败时静默跳过

### 4. 数据存储位置
```
~/.memorix/data/<projectId>/
├── observations.json     # 主数据
├── id-counter.txt        # ID 计数器
├── entities.jsonl        # 知识图谱节点
└── relations.jsonl       # 知识图谱边
```

### 5. 添加新 Agent 的检查清单
1. `types.ts` — 更新 `RuleSource` 和 `AgentTarget` 类型
2. `rules/adapters/<agent>.ts` — 实现 `RuleFormatAdapter`
3. `rules/syncer.ts` — 注册适配器
4. `workspace/mcp-adapters/<agent>.ts` — 实现 `MCPConfigAdapter`
5. `workspace/engine.ts` — 注册适配器 + 配置 SKILLS_DIRS
6. `hooks/normalizer.ts` — 添加事件映射和格式解析
7. `hooks/installers/index.ts` — 添加 Hook 安装器
8. `server.ts` — 更新 RULE_SOURCES 和 AGENT_TARGETS 数组及工具描述
9. `tests/rules/<agent>-adapter.test.ts` — 编写测试

### 6. 项目识别
- 基于 Git remote URL → 规范化为 `user/repo` 格式
- 无 Git → 回退为目录名
- `projectId` 决定数据存储的子目录

---

## 开发时常见操作

### 修改 MCP 工具
1. 在 `server.ts` 中找到对应的 `server.registerTool()`
2. 修改 `inputSchema` (使用 Zod) 和处理函数
3. 输入参数从 handler 的第一个参数解构
4. 确保返回 `{ content: [{ type: 'text', text: ... }] }`

### 调试 MCP Server
```bash
# 将 stderr 输出到文件
node dist/cli/index.js serve 2>debug.log

# 查看数据
cat ~/.memorix/data/<projectId>/observations.json | jq .length
```

### 运行特定测试
```bash
pnpm test -- --grep "pattern-detector"
pnpm test -- tests/rules/copilot-adapter.test.ts
```

### 重置项目数据
```bash
rm -rf ~/.memorix/data/<projectId>/
```

---

## 架构核心理念

1. **优雅降级** — 没有 embedding? 用纯文本搜索。没有 Git? 用目录名。Hook 安装失败? 静默跳过。
2. **跨 Agent 兼容** — 在任何支持 MCP 的 AI IDE 中都能工作。
3. **Token 节约** — 3层渐进式披露，Agent 只获取需要的信息。
4. **隐式记忆** — Hooks 自动抓取有价值的信息，不依赖 Agent 主动存储。
5. **可扩展** — 新 Agent 只需实现适配器接口，不修改核心逻辑。

---

## 相关文档

| 文档 | 内容 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 系统架构总览、数据流、模块分层 |
| [MODULES.md](./MODULES.md) | 每个模块的详细实现、算法、注意事项 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 开发环境、命令、项目结构、如何添加新 Agent |
| [DESIGN_DECISIONS.md](./DESIGN_DECISIONS.md) | 12 个关键设计决策 (ADR) |
| [API_REFERENCE.md](./API_REFERENCE.md) | 22+9 个 MCP 工具的完整 API 参考 |
| [KNOWN_ISSUES_AND_ROADMAP.md](./KNOWN_ISSUES_AND_ROADMAP.md) | 已知问题、路线图、技术债务 |

---

## 更新日志

| 日期 | 作者 | 变更 |
|------|------|------|
| 2026-02-15 | AI (Antigravity) + 项目创建者 | 初始文档创建，覆盖所有核心模块 |
| 2026-03-09 | AI (Windsurf) + 项目创建者 | v1.0.0 更新: Team协作/自动清理/工具合并/LLM增强 |
