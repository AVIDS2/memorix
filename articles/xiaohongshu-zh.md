# 小红书笔记

## 标题（20字内）
AI编程助手总是失忆？Memorix给它装上共享记忆

## 封面文字
Cursor × Claude Code × Windsurf
共用同一套项目记忆

## 正文（≥600字，测评/教程类）

用Cursor写代码，跟它解释了一个数据库迁移方案。第二天打开Claude Code继续，它完全不知道昨天发生了什么。

更头疼的是，就算同一个IDE，换个session也全忘了。每次都要重新解释项目背景、架构决策、踩过的坑。

这是目前所有AI编程助手的通病——每个Agent都是失忆的，而且彼此之间记忆完全隔离。

Memorix做的事情很简单：给这些Agent装上共享的、持久的项目记忆。

### 它解决了什么问题？

**跨Agent记忆共享**：Cursor学到的，Claude Code也能用；Windsurf修的bug，Copilot也知道上下文。10个Agent共用同一套本地记忆。

**Git变成可搜索的记忆**：装了post-commit hook之后，commit历史自动变成工程记忆，还有噪音过滤——lockfile变更、merge commit、typo修复这些会被跳过。问Agent"上周auth模块改了什么"，它从真实的git历史里回答。

**不只记"改了什么"，还记"为什么"**：比如"选PostgreSQL不选MongoDB是因为X"这种推理记忆，下次遇到类似选型时Agent能参考之前的决策。

**记忆质量自动管理**：去重、压缩、过期清理，不会越积越乱变成噪音。

### 怎么用？

三行命令：

```
npm install -g memorix
memorix init
memorix serve
```

然后在IDE的MCP配置里加一行就行，Agent就有了持久项目记忆。

### 支持哪些IDE/Agent？

核心支持：Cursor、Claude Code、Windsurf
扩展支持：GitHub Copilot、Kiro、Codex
社区支持：Gemini CLI、OpenCode、Antigravity、Trae

一共10个客户端，主流的基本覆盖了。

### 数据安全

所有数据都在本地（SQLite + Orama），不上传云端。Apache 2.0开源协议。

搜索 Memorix 可以找到，GitHub和npm都有。

#AI编程 #Cursor #ClaudeCode #开发工具 #开源 #效率工具 #MCP

---

## 发布注意事项
- ❌ 不要放GitHub/npm直接链接（小红书禁止站外导流）
- ✅ 引导用户搜索"Memorix"
- ✅ 配图建议：终端截图（3行命令）+ 架构简图 + 效果对比图
- ✅ 封面用醒目大字卡片风格
