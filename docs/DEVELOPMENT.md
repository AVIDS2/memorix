# Memorix 开发指南

> 最后更新: 2026-03-09 (v1.0.0)

---

## 环境准备

### 前置要求
- Node.js >= 18
- pnpm (推荐) 或 npm
- Git

### 项目初始化
```bash
git clone <repo-url>
cd memorix
pnpm install
```

### 可选依赖
```bash
# 启用向量搜索 (推荐)
pnpm add fastembed
```
不安装也完全可以运行 — 会自动退化为纯全文搜索。

---

## 常用命令

### 开发
```bash
pnpm dev          # tsup watch 模式, 监听文件变化自动编译
pnpm build        # 生产构建
```

### 测试
```bash
pnpm test         # vitest 运行所有测试
pnpm test:watch   # vitest watch 模式
pnpm test -- --grep "copilot"  # 运行匹配的测试
```

### 运行 MCP Server
```bash
# 本地开发
node dist/cli/index.js serve

# 或通过 npx (模拟用户安装)
npx -y memorix@latest serve
```

### 代码质量
```bash
pnpm lint         # ESLint
pnpm typecheck    # TypeScript 类型检查
```

---

## 项目结构

```
memorix/
├── src/
│   ├── server.ts              # MCP Server 主入口 (22个默认+9可选工具)
│   ├── types.ts               # 所有核心类型定义
│   │
│   ├── cli/                   # CLI 入口 (Citty)
│   │   ├── index.ts           # 主命令定义
│   │   └── commands/          # 子命令
│   │       ├── serve.ts       # memorix serve
│   │       ├── status.ts      # memorix status
│   │       ├── sync.ts        # memorix sync
│   │       ├── hook.ts        # memorix hook
│   │       └── hooks.ts       # memorix hooks
│   │
│   ├── memory/                # 记忆层
│   │   ├── graph.ts           # 知识图谱管理
│   │   ├── observations.ts    # Observation 生命周期
│   │   ├── retention.ts       # 衰减 & 保留
│   │   ├── entity-extractor.ts # 正则实体抽取
│   │   └── auto-relations.ts  # 自动关系推断
│   │
│   ├── store/                 # 存储层
│   │   ├── orama-store.ts     # Orama 搜索引擎
│   │   └── persistence.ts     # 磁盘持久化
│   │
│   ├── compact/               # Compact 引擎
│   │   ├── engine.ts          # 3层编排
│   │   ├── index-format.ts    # 索引格式化
│   │   └── token-budget.ts    # Token 预算
│   │
│   ├── embedding/             # Embedding 层
│   │   ├── provider.ts        # 抽象接口
│   │   ├── api-provider.ts    # OpenAI-compatible API Embedding
│   │   ├── fastembed-provider.ts # FastEmbed 实现
│   │   └── transformers-provider.ts # HuggingFace Transformers.js
│   │
│   ├── llm/                   # LLM 增强模式
│   │   ├── provider.ts        # LLM 提供者 (OpenAI/Anthropic/OpenRouter)
│   │   └── memory-manager.ts  # Compact-on-Write + 语义去重
│   │
│   ├── team/                  # 团队协作
│   │   ├── index.ts           # 统一导出
│   │   ├── registry.ts        # Agent 注册/注销/状态
│   │   ├── file-locks.ts      # 协商式文件锁
│   │   ├── tasks.ts           # 任务板 + 依赖管理
│   │   ├── messages.ts        # 直接消息 + 广播
│   │   └── persistence.ts     # team-state.json 读写
│   │
│   ├── dashboard/             # Web Dashboard
│   │   ├── server.ts          # HTTP 服务器
│   │   └── static/            # 前端资源
│   │
│   ├── skills/                # Skills 引擎
│   │   └── engine.ts          # 发现/生成/注入
│   │
│   ├── hooks/                 # Hooks 系统
│   │   ├── types.ts           # Hook 类型定义
│   │   ├── normalizer.ts      # 多 Agent 格式统一
│   │   ├── pattern-detector.ts # 模式检测
│   │   ├── handler.ts         # 事件处理 & 冷却
│   │   └── installers/        # Hook 安装器
│   │       └── index.ts
│   │
│   ├── workspace/             # 工作空间同步
│   │   ├── engine.ts          # 同步引擎
│   │   ├── workflow-sync.ts   # Workflow 同步
│   │   ├── applier.ts         # 配置写入
│   │   ├── sanitizer.ts       # 配置清洗
│   │   └── mcp-adapters/      # MCP 配置适配器
│   │       ├── windsurf.ts
│   │       ├── cursor.ts
│   │       ├── claude-code.ts
│   │       ├── codex.ts
│   │       ├── copilot.ts
│   │       └── antigravity.ts
│   │
│   ├── rules/                 # 规则同步
│   │   ├── syncer.ts          # 规则引擎
│   │   └── adapters/          # 规则格式适配器
│   │       ├── cursor.ts
│   │       ├── claude-code.ts
│   │       ├── codex.ts
│   │       ├── windsurf.ts
│   │       ├── copilot.ts
│   │       ├── antigravity.ts
│   │       ├── kiro.ts
│   │       ├── opencode.ts
│   │       └── trae.ts
│   │
│   ├── config.ts              # 统一配置 (env > config.json > 默认值)
│   └── project/               # 项目检测
│       └── detector.ts
│
├── tests/                     # 测试文件 (镜像 src 结构)
│   ├── memory/
│   ├── store/
│   ├── compact/
│   ├── hooks/
│   ├── workspace/
│   └── rules/
│
├── docs/                      # 文档 (本目录)
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

---

## 添加新 Agent 支持

Memorix 设计为高度可扩展。添加新 Agent 需要以下步骤:

### Step 1: 规则适配器

创建 `src/rules/adapters/<agent>.ts`:

```typescript
import type { RuleFormatAdapter, UnifiedRule, RuleSource } from '../../types.js';

export class MyAgentAdapter implements RuleFormatAdapter {
  readonly source: RuleSource = 'my-agent';
  readonly filePatterns = ['.my-agent/rules.md'];

  parse(filePath: string, content: string): UnifiedRule[] {
    // 解析 Agent 特有的规则格式 → UnifiedRule[]
  }

  generate(rules: UnifiedRule[]): { filePath: string; content: string }[] {
    // UnifiedRule[] → 生成 Agent 特有的规则文件
  }
}
```

然后在 `rules/syncer.ts` 中注册:
```typescript
import { MyAgentAdapter } from './adapters/my-agent.js';
// ... 添加到 adapters 数组
```

### Step 2: MCP 配置适配器

创建 `src/workspace/mcp-adapters/<agent>.ts`:

```typescript
import type { MCPConfigAdapter, MCPServerEntry, AgentTarget } from '../../types.js';

export class MyAgentMCPAdapter implements MCPConfigAdapter {
  readonly source: AgentTarget = 'my-agent';

  parse(content: string): MCPServerEntry[] { /* ... */ }
  generate(servers: MCPServerEntry[]): string { /* ... */ }
  getConfigPath(projectRoot?: string): string { /* ... */ }
}
```

然后在 `workspace/engine.ts` 中注册。

### Step 3: Hook Normalizer

在 `hooks/normalizer.ts` 中:
1. 在 `EVENT_MAP` 添加事件映射
2. 在 `detectAgent()` 添加识别逻辑
3. 创建 `normalizeMyAgent()` 函数
4. 在 `normalizeHookInput()` 的 switch 中添加分支

### Step 4: 更新类型

在 `types.ts` 中:
- `RuleSource` type 添加新值
- `AgentTarget` type 添加新值

### Step 5: 更新 Server

在 `server.ts` 中:
- `RULE_SOURCES` 数组添加新值
- `AGENT_TARGETS` 数组添加新值
- 更新工具描述文本

### Step 6: 测试

创建 `tests/rules/<agent>-adapter.test.ts`:
- 解析测试 (各种边界情况)
- 生成测试
- Round-trip 测试 (parse → generate → parse)

---

## 测试规范

### 测试文件命名
- `tests/<module>/<file>.test.ts` — 镜像 src 结构

### 测试模式
```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('ModuleName', () => {
  beforeEach(() => {
    // 重置状态
  });

  it('should handle normal case', () => { /* ... */ });
  it('should handle edge case', () => { /* ... */ });
  it('should handle error case', () => { /* ... */ });
});
```

### 当前测试覆盖
- **753 个测试** 跨 **56 个文件**
- 所有测试通过, 零回归
- 关键模块都有边界情况测试

---

## 调试技巧

### MCP Server 日志
所有日志输出到 `stderr` (因为 `stdout` 用于 MCP 协议通信):
```bash
memorix serve 2>debug.log
```

### 检查数据
```bash
# 查看项目数据目录
ls ~/.memorix/data/

# 查看 observations
cat ~/.memorix/data/<projectId>/observations.json | jq .

# 查看知识图谱
cat ~/.memorix/data/<projectId>/entities.jsonl
cat ~/.memorix/data/<projectId>/relations.jsonl
```

### 重置数据
```bash
# 删除特定项目数据
rm -rf ~/.memorix/data/<projectId>/

# 删除所有数据
rm -rf ~/.memorix/data/
```

### npx 缓存问题
如果遇到 `MODULE_NOT_FOUND` 错误:
```bash
# 清除 npx 缓存
rm -rf ~/AppData/Local/npm-cache/_npx/
# 或
npm cache clean --force
```

---

## 发布流程

### 版本管理
```bash
# 修改 package.json 中的 version
npm version patch   # 0.4.0 → 0.4.1
npm version minor   # 0.4.1 → 0.5.0
npm version major   # 0.5.0 → 1.0.0
```

### 发布到 npm
```bash
pnpm build
npm publish
```

### 发布检查清单
- [ ] 所有测试通过 (`pnpm test`)
- [ ] 类型检查通过 (`pnpm typecheck`)
- [ ] 构建成功 (`pnpm build`)
- [ ] package.json version 已更新
- [ ] CHANGELOG 已更新
- [ ] README 已更新
