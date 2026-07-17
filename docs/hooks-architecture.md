# Memorix Hooks Architecture — 无感知自动记忆

## 核心目标

用户安装 Memorix 后，所有 Agent 的对话、决策、bug 修复、配置变更都**自动记录**，
切换 Agent/窗口/对话时**自动注入**相关上下文，零操作、无感知。

## 各 Agent Hooks 格式对照

### 事件映射表

| 语义 | VS Code Copilot | Claude Code | Codex | Windsurf | Cursor (Beta) | Kiro |
|------|----------------|-------------|-------|----------|---------------|------|
| 会话开始 | SessionStart | SessionStart | SessionStart | — | — | — |
| 用户输入 | UserPromptSubmit | UserPromptSubmit | UserPromptSubmit | pre_user_prompt | beforeSubmitPrompt | user prompt |
| 工具调用前 | PreToolUse | PreToolUse | — | pre_mcp_tool_use | beforeMCPExecution | — |
| 工具调用后 | PostToolUse | PostToolUse | PostToolUse | post_mcp_tool_use | — | — |
| 文件编辑后 | PostToolUse(write) | PostToolUse(write) | PostToolUse(apply_patch) | post_write_code | afterFileEdit | file save |
| 命令执行后 | PostToolUse(cmd) | PostToolUse(cmd) | PostToolUse(Bash) | post_run_command | — | — |
| AI 回复后 | — | — | Stop | post_cascade_response | — | agent turn |
| 上下文压缩前 | PreCompact | PreCompact | PreCompact | — | — | — |
| 会话结束 | Stop | Stop | Stop | — | stop | — |

### 配置文件位置

| Agent | 配置路径 | 格式 |
|-------|---------|------|
| VS Code Copilot | `.github/hooks/*.json` | Claude Code 兼容 |
| Claude Code | `.claude/settings.json` | 原生 |
| Codex | Memorix 插件内 `hooks/hooks.json` | Codex plugin hooks；通过 `memorix setup --agent codex` 安装 |
| Windsurf | `.windsurf/cascade.json` | Windsurf 格式 |
| Cursor | `.cursor/hooks.json` | Cursor 格式 |
| Kiro | `.kiro/hooks/*.hook.md` | Markdown + YAML |

### stdin/stdout 通信协议

所有 Agent 都用 **stdin JSON → stdout JSON** 通信，但字段名不同：

```
// VS Code / Claude Code
{ "hookEventName": "PostToolUse", "sessionId": "...", "cwd": "...", "tool_name": "write", ... }

// Codex
{ "hook_event_name": "PostToolUse", "session_id": "...", "cwd": "...", "tool_name": "apply_patch", ... }

// Windsurf  
{ "agent_action_name": "post_write_code", "trajectory_id": "...", "tool_info": { "file_path": "..." } }

// Cursor
{ "hook_event_name": "afterFileEdit", "conversation_id": "...", "generation_id": "...", ... }
```

## Memorix Hook Handler 设计

### 统一入口

```bash
memorix hook <normalized_event> [--agent <agent_name>]
```

通过 stdin 接收 Agent 原始 JSON，内部做格式归一化。

### 归一化事件

| 归一化事件 | 自动记忆行为 |
|-----------|------------|
| `session_start` | 搜索相关记忆 → stdout 注入上下文 |
| `post_edit` | 分析变更 → 记录 what-changed |
| `post_command` | 分析命令结果 → 记录 problem-solution (如有错误) |
| `post_tool` | 分析 MCP 工具调用 → 记录相关操作 |
| `pre_compact` | 压缩前保存当前上下文摘要 |
| `session_end` | 总结本次会话 → 记录决策和发现 |
| `user_prompt` | 模式检测 → 判断是否需要注入记忆 |

### 智能过滤 — 不是什么都记

- **最小内容长度**: 300 字符（避免记录琐碎操作）
- **去重**: 相似度 > 0.85 的内容不重复记录
- **冷却时间**: 同类事件 30 秒内不重复触发
- **模式检测**: 只记录有价值的内容（决策、错误、学习、配置变更）

## 一键安装

```bash
memorix hooks install
# 自动检测已安装的 Agent → 生成对应配置文件
# 支持: --agent cursor|windsurf|claude|copilot|kiro
# 支持: --project (仅当前项目) | --global (全局)
```

Codex 使用插件入口而不是 fallback 配置文件：

```bash
memorix setup --agent codex --global
```

安装后，Codex 首次要求时在 `/hooks` 中审核 Memorix 插件的 hook 定义。

## 文件结构

```
memorix/
  src/
    hooks/
      handler.ts        # 统一 hook handler 入口
      normalizer.ts     # 各 Agent stdin 格式归一化
      analyzers/
        edit-analyzer.ts    # 文件变更分析 → what-changed
        command-analyzer.ts # 命令结果分析 → problem-solution  
        session-analyzer.ts # 会话总结 → decision/discovery
        pattern-detector.ts # 模式检测 (decision/error/learning)
      installers/
        base.ts             # 安装器基类
        claude-installer.ts # Claude Code / VS Code Copilot
        windsurf-installer.ts
        cursor-installer.ts
        kiro-installer.ts
    cli/commands/
      hooks.ts          # `memorix hooks install/uninstall/status` 命令
```
