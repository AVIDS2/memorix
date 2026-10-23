# Memorix 长期开发路线：1.9.12 到 2.0

> 状态：规划基线
>
> 更新时间：2026-10-23
>
> 这份文档是后续编码任务的总计划。它定义版本主题、依赖关系、成功标准和
> 2.0 的启动条件。具体实现任务、测试结果和最终版本范围必须在执行过程中
> 回写到本文件或对应的专项文档，避免路线图与代码状态分离。

## 0. 总体结论

Memorix 已经超过“给 coding agent 加一个记忆工具”的阶段。当前产品同时包含：

- 本地 SQLite canonical store；
- FTS5、Orama、embedding 和 CodeGraph 等 derived evidence views；
- MCP stdio、legacy HTTP、modern HTTP、CLI、SDK、Dashboard、hooks、plugins
  和 memcode 多个入口；
- observation、reasoning、Git、session、team、long-term memory、knowledge
  workspace 和 orchestration 多种记忆与协调边界；
- 大量 agent/host 适配、配置生成、规则同步和发布 manifest。

因此下一阶段的主要问题不是继续增加 memory kind，也不是立刻把整个系统改成
云端服务。真正需要解决的是：

1. agent 为什么看到某条记忆；
2. 这条记忆来自哪里、是否新鲜、是否冲突；
3. 系统什么时候应该拒绝把内容放进上下文；
4. 本地、HTTP、MCP、插件和多 agent 入口是否遵守同一个契约；
5. 记忆到底节省了多少 token、减少了多少探索、改善了多少任务恢复；
6. 发布和自动更新是否能证明包的来源与完整性。

路线采用五个版本主题：

| 版本 | 主题 | 主要目的 | 版本性质 |
|---|---|---|---|
| 1.9.12 | 安全与发布链收紧 | 先修发布 provenance、自动更新和安全门槛 | 快速补丁 |
| 1.10 | 可信上下文与契约收敛 | 把现有能力变成可解释、可衡量的上下文系统 | 主线迭代 |
| 1.11 | 本地优先 relay 与协作预览 | 在保持 SQLite canonical 的前提下验证跨设备、跨 agent 协作 | opt-in 预览 |
| 1.12 | Agent 生态与开发者平台 | 降低新 host、新 skill、新 adapter 的接入成本 | 生态迭代 |
| 2.0 | 远程多租户 memory platform | 只有公共契约确实需要破坏性重置时才启动 | 条件式大版本 |

1.9.x 仍然保留安全、兼容性和数据完整性补丁通道。普通 feature 不再继续堆在
1.9.x 上；1.10 才是新的功能主线。

## 1. 当前基线和不可变约束

### 1.1 当前事实

当前发布基线是 `v1.10.1`。1.9.12 的 CJK 搜索、搜索回退、大库 alias 迁移、
Node 26 Pi hooks、Qwen hooks、API Route provider、session label、发布
provenance 收紧和后台更新脚本隔离，已经与 1.10 的可信上下文、检索收据、
真实矩阵评估和容量门禁一起发布。

`v1.10.1` 已从提交 `7c51d34` 发布到 npm、官方 MCP Registry 和 GitHub
Release。后续 `main` 进入 1.11 的本地优先 relay 与协作预览准备阶段。

1.9.12 已完成：

- publish workflow 增加 `npm audit signatures`；
- 发布 provenance 失败时删除无 provenance 的 `npm publish --ignore-scripts`
  fallback，改为 fail-closed；
- opt-in background auto-update 使用 `npm install --ignore-scripts`；
- 版本、CHANGELOG、MCP Registry 和 plugin manifests 同步到 `1.9.12`；
- 本地 lint、build、全量测试、legacy/modern stdio、HTTP conformance 和
  packed package install smoke 已通过。

公开 issue #327 仍保持开放，等待报告者补充可复现的包与扫描证据；这不阻止
已发布版本继续维护，但不能被记录为已证伪的安全报告。

### 1.2 必须保留的产品契约

后续所有版本都遵守以下边界：

- SQLite 是本地 canonical record；Orama、FTS、embedding、CodeGraph 投影和
  Dashboard 索引都不能决定“数据库失败就是空项目”。
- 默认路径保持 local-first；用户没有明确配置 relay 或 hosted adapter 时，
  数据不上传。
- legacy MCP、modern MCP、stdio、HTTP 和现有 agent plugins 继续兼容，直到
  2.0 触发条件满足并完成迁移设计。
- `micro/lite/team/full` profile 继续作为渐进披露边界，不把所有工具定义一次性
  压进 agent context。
- candidate、ephemeral、unverified、long-term candidate 不得因为索引或排序
  方便而自动晋升为 durable context。
- CodeGraph 是 source-backed evidence plane，不是源代码的第二份 canonical copy。
- 任何新 provider、relay、media pipeline 或 agent integration 都必须有来源、
  失败、重建、删除、配额和审计语义。
- 版本发布必须有明确的 tag、commit、package、manifest、CI、package smoke
  和可追溯发布记录。

### 1.3 不能用来证明完成的东西

以下内容只能作为辅助证据，不能单独宣称功能完成：

- 一次本地测试通过，不能证明所有 agent/OS/Node 版本兼容；
- 一个 recall 数字，不能证明 coding task 变快或 token 成本下降；
- `valueCategory=core`，不能单独证明内容来源已验证；
- npm provenance 或 registry signature，能证明发布来源和包完整性链路，不能
  单独证明源码没有恶意逻辑；
- 一个 hosted backend demo，不能证明多租户、断网、冲突和删除语义已经成立；
- 一个 plugin 可以安装，不能证明 hook、规则、MCP、版本升级和卸载都正确。

## 2. 1.9.12：安全与发布链收紧

### 2.1 版本目标

1.9.12 是窄范围、低风险、快速发布的安全补丁。它不改变 memory schema、MCP
tool contract、默认 provider、项目绑定或存储真相模型。

它解决两个已经可以立即确认的问题：

1. 发布链不能在 provenance 失败时悄悄退回无 provenance 发布；
2. 自动更新的 lifecycle scripts 不应在后台安装时默认执行。

### 2.2 已完成的代码范围

- publish workflow 在构建前运行 `npm audit signatures`；
- publish workflow 删除无 provenance fallback；如果 npm publish 返回异常但包
  已经可见，允许确认已发布；如果包不可见且 provenance 失败，workflow 失败，
  等待人工判断；
- `prepublishOnly` 纳入 `npm audit signatures`；
- background auto-update 使用 `--ignore-scripts`；
- release contract tests 和 update checker tests 覆盖这些行为；
- version metadata、CHANGELOG、MCP Registry、plugin manifests 和 release
  docs 同步到 1.9.12。

### 2.3 1.9.12 还要完成的发布门槛

- 远程 Ubuntu、Windows、macOS、Docker、Node 26、typecheck、Registry metadata
  全部通过；
- 重新运行全量本地测试和 package smoke；
- 对 npm tarball 记录 version、SHA-512、registry integrity 和 workflow commit；
- 对 #327 要求 exact version、tarball checksum、被检测文件 hash、扫描 vendor、
  engine/version、report ID、quarantine hash 和扫描日志；
- 对安全报告保持“未验证”状态，不能宣布感染，也不能在没有证据时直接关闭；
- 发布后更新 `ACTIVE_WORK.md`、`docs/DEVELOPMENT.md`、`docs/README.md` 和本路线图。

### 2.4 1.9.12 不做的事情

- 不加入 hosted backend；
- 不修改 observation admission 的完整语义；
- 不进行 SQLite schema reset；
- 不新增 MCP tools；
- 不更改任何已发布 memory 的 visibility；
- 不进行 2.0 迁移；
- 不因为一个未复现的安全 issue 重写整个存储系统。

## 3. 1.10：可信上下文与契约收敛

执行状态：第一块“receipt governance transparency”已开始实现。当前 receipt
已经暴露 optional-evidence 的 freshness、trust、quality、conflict 和
evidenceCount。第二块已补 retrieval mode、code provider、fallback reason、
candidate/selected/omitted counts；第三块已为预算省略项补最多三个稳定
sample IDs，不保存原始内容。第一条本地性能基线已记录：Windows Node
22.22.3、1,000 records、20 runs、embedding/LLM disabled，specific query
p95 9.629ms，broad query p95 12.079ms；10,000 records 时 seed/index
12.633s，specific query p95 17.259ms，broad query p95 125.991ms。这个结果说明
broad retrieval 的数据量增长成本已经是 1.10 的实测性能问题。下一步扩展
40k 数据量和 receipt assembly latency，再进入 runtime binding 和 adapter
contract。40,000 records 时 seed/index 45.658s、specific query p95 2.187ms、
broad query p95 84.462ms；specific path 对热缓存和 query distribution 敏感，
broad path 是更稳定的容量信号。随后 large-store gate 已增加 bounded
receipt 测量：同一 Windows Node 22.22.3、40k records 下，MCP context 端到端
为 573.561ms，receipt assembly 为 7ms，说明当前 receipt 组装不是容量瓶颈。
下一步进入 runtime binding receipt 和 adapter contract，并继续保留端到端
context 与内部 assembly 两个指标。

Runtime binding 的第一条实现已落地：`memorix_session_start` 返回 additive
`structuredContent.binding` receipt，legacy HTTP、stateless HTTP 和直接 server
路径共享同一字段。receipt 记录 resolved/unresolved、source、explicit、project
ID、project root/data directory hash 和 transport；测试确认不会泄露原始路径、
MCP session ID 或 project handle。现在 receipt 也记录 verified Git remote 的
hash/host、handle 的 hash 与 created/last-used/expiry 窗口；stateless handle
创建使用项目 data directory，后续请求不会回退到 control-plane base database。
下一步进入 adapter registry contract。

Adapter registry contract 的第一条实现已落地：`src/integrations/registry.ts`
现在为全部 19 个 agent 目标生成 schema version 1 capability manifest，包含
transport/command、artifact、hook lifecycle、rules/skills/guidance、scope、
生命周期动作、host compatibility 状态、运行时要求和来源文件。`setup` 的
目标列表直接从 registry 派生；Qwen 已进入 registry，但明确为 hooks-only，
不会被误报为完整 setup 目标。registry 校验和 setup/doctor 回归测试已通过。

Doctor parity 已接入同一 manifest：每个 agent entry 现在报告预期/观测到的
transport、artifact 类别、生命周期能力、registry source 和 parity issues。
Qwen 的 MCP lane 会保持 skipped，hooks-only 的 install/uninstall 能力会明确
保留，repair/doctor 尚未被伪装成已实现。

对于 host 提供稳定路径的 rules 和 hooks，doctor parity 已增加具体
`artifactChecks`（scope、path、exists、status）；package/skill 路径继续保留
为 manifest expectation，直到安装根目录可以跨启动方式可靠解析。

Memory ownership matrix 已补入 [1.3 Memory Architecture](1.3-MEMORY-ARCHITECTURE.md)
作为唯一权威文档，覆盖 Observation、Reasoning、Claim、Wiki/Workflow、
Session/Team、Long-term Memory 和 CodeGraph，并明确 Task Workset 是派生视图。

Evaluation 的第一步也已完成：现有 harness 新增 20 项 1.10 task matrix，覆盖
continuity、retrieval、safety、runtime 和 integration 五类边界，并固定
first-action、recovery、precision/recall、stale/conflict rejection、abstention、
token、latency、RSS、fallback/degraded 和 review cost 指标。`gate:context-matrix`
验证矩阵 contract，`gate:context-runtime` 已将 20 项矩阵执行到真实运行路径并
记录 40k large-store transport baseline；100k capacity gate 也已单独通过。

已有 replay harness 的第一组实测也已记录：embedding disabled、4 个固定问题
全部命中（4/4），最大单轮 277 tokens、0 次超预算；session dedup 将重复展示
从 4/16（25%）降到 3/16（18.75%），命中率保持 100%。这组结果只覆盖已映射
的 continuity/retrieval baseline，不能代表其余矩阵 case。

Operator surface 也已对齐：HTTP control-plane `/health` 现在携带
`transport: dashboard` 的 privacy-safe binding receipt，包含 verified project
和 data directory hashes 以及 Git remote state，不暴露本地路径。

Retrieval facade 也开始收敛：`compactSearch`、MCP `memorix_search` 和 CLI
`memory search --json` 共享 schema version 1 的 retrieval receipt，记录实际
search mode、candidate/selected/omitted counts、token budget omissions、fallback
reason、token count 和 elapsed time；查询文本与原始 memory 内容不进入 receipt。
底层 Orama/SQLite search 现在保留 request-level diagnostics，使这些字段来自
实际检索路径而不是调用方猜测。
Receipt 还通过 `derivedViews` 统一记录 FTS、Orama、embedding、CodeGraph 的
generation、freshness、rebuild status 和 bounded failure reason；这项补强已在
main 验证，但属于 1.10.0 之后的 Unreleased 增量。

1.10 的真实任务矩阵已执行完成：20/20 cases passed。Windows Node 22.22.3、
embeddings/LLM disabled 的基线为 memory hit precision/recall 1.00/1.00、
stale/conflict rejection 1.00/1.00、abstention precision 0.95，矩阵 p50/p95
为 2ms/255ms，peak RSS 为 428,867,584 bytes。40k packed large-store gate
和 100k capacity gate 均通过；40k MCP context/receipt assembly 为
518.983ms/6ms，100k 为 1,099.809ms/7ms，两个 gate 都没有 failed checks。
可复现入口为 `npm run gate:context-runtime`（20-case + 40k）以及
`node scripts/large-store-gate.mjs --records 100000`（100k 容量门禁）。
同一 `scripts/benchmark-retrieval.mjs --records 1000 --runs 20` 在 v1.9.11
和当前 1.10 main 上复跑：specific p95 为 9.283ms -> 8.925ms，broad p95
为 12.301ms -> 12.298ms；该结果证明热 lexical 路径没有回归，但不宣称
统计显著的性能提升。

### 3.1 版本定位

1.10 是下一条真正的产品主线。它的核心不是“加入更多记忆”，而是让 Memorix
能回答：

> 这条上下文为什么被选中？它来自哪里？它现在还可靠吗？系统为什么省略了
> 其他内容？如果证据不够，系统为什么拒绝注入？

1.10 目标周期为 6–8 周。它是 additive evolution，保留现有 MCP、SQLite、
plugin 和 agent integration，不做公共契约 reset。

### 3.2 1.10 的主要工作面

#### A. Context Receipt 统一契约

建立一个跨 MCP、CLI、SDK、Dashboard、session handoff 和 CodeGraph context 的
统一 receipt。至少包含：

- task 和 project identity；
- 被选择的 observation/claim/code facts；
- 每条内容的 source/sourceDetail；
- createdAt、lastValidatedAt、freshness；
- admissionState、reviewState、visibility、scope；
- 选择理由、相关度、冲突情况和 evidence count；
- 使用的 retrieval mode：FTS、Orama、embedding、graph、fallback；
- candidate 数量、被省略数量和省略原因；
- estimated token count 和 token budget；
- abstain、defer、blocked、degraded 的原因；
- snapshot、commit、provider 或 model version（有记录时）。

Receipt 要能被机器读取，也要能被人通过 CLI/Dashboard 解释。它不是把更多原始
文本塞给模型，而是用少量结构化信息说明上下文是如何形成的。

#### B. Provenance 和 evidence chain

把当前可声明的 source metadata 和可验证 evidence 区分开：

- explicit/manual、Git、hook、model-derived、remote-sync、import 等写入通道
  必须有清晰 sourceDetail；
- code-backed、Git-backed、test-backed、document-backed evidence 记录来源 hash
  或 snapshot reference；
- 每次形成、合并、演化、晋升、归档和覆盖都记录原因；
- evidence 过期、当前代码不再引用、关联 commit 被重写或内容发生冲突时，
  receipt 必须显示 degraded/stale/conflict；
- 不能把 `core`、`verified`、`current` 作为同一个概念使用；
- 只有明确 review 或 source-backed evidence 才能把内容标记为 verified。

#### C. Admission、quarantine 和 abstention

统一新写入的生命周期：

`candidate -> qualified -> durable`，失败或证据不足时进入 `unverified`、
`deferred` 或 `blocked`。

需要明确：

- explicit user store 与 automatic hook capture 的默认 admission 不同；
- formation timeout/failure 不应把未经 enrichment 的自动内容伪装成普通 durable；
- model-derived、remote-sync、unknown-agent 内容默认先 quarantine；
- candidate 不进入默认 agent context，除非经过 Code Memory 或人工 evidence
  qualification；
- conflict 未解决时不得使用“最后写入覆盖”伪装成已确认事实；
- legacy observations 可以继续兼容，但要在 receipt 中标记 legacy/unverified，
  不能把旧记录错误升级为新 verified record；
- abstention 必须能在 CLI、MCP result 和 Dashboard 中解释。

#### D. Retrieval facade 和 derived view 统一

把 lexical、Orama、embedding、graph retrieval 的共同输出收敛为一个内部 facade：

- 所有 derived view 携带 generation、freshness、rebuild status 和 failure reason；
- FTS 不可用时回退必须显式；
- Orama 过期或重建中时不能返回空项目；
- embedding provider 失败时不能覆盖 lexical evidence；
- CJK、punctuation、alias、large-store 和 project isolation 继续由同一 facade
  提供结果；
- 统一记录 p50/p95 latency、candidate count、fallback count 和 token estimate；
- provider 的结果不能直接决定质量，必须经过 evidence/admission/governor。

#### E. Runtime 和 project binding 收敛

stdio、legacy HTTP、modern HTTP、Dashboard、memcode 共享 business runtime，但
需要统一 binding facade：

- project identity 由服务器验证，客户端路径只是 detection anchor；
- session、Mcp-Project-Handle、projectRoot、Git remote 和 data directory 的
  关系可诊断；
- handle 不能被当作完整认证主体；
- 同一个 project 的 multiple session 不得造成状态污染；
- stale session、expired handle、project switch 和 runtime lease 都有统一 receipt；
- legacy MCP 只保留在 transport adapter 层，不再新增 legacy-specific business
  logic；
- HTTP 生产配置不允许通过测试环境变量绕过绑定安全。

#### F. Integration Adapter Contract

为每个 agent/host 生成 capability manifest，至少描述：

- MCP transport 和 command；
- plugin/package 文件；
- hooks 支持和生命周期事件；
- rules、skills、guidance 文件；
- global/project scope；
- install、repair、doctor、uninstall 行为；
- 当前 host version 兼容范围；
- 是否需要 HTTP、stdio、projectRoot 或额外 credential；
- manifest、生成文件和人工文档的来源。

新 agent 必须先进入 adapter registry，再生成 plugin/hook/rules/config。这样可以
减少每次发布在 19 个集成目标之间手工同步的成本。

#### G. Memory ownership matrix

为 Observation、Reasoning、Claim、Wiki、Workflow、Session、Long-term、CodeGraph
写出一张唯一权威矩阵：

| 类型 | 谁写入 | 谁验证 | 谁默认读取 | 能否自动晋升 |
|---|---|---|---|---|
| Observation | explicit/hook/agent | admission/evidence | task context | 取决于来源 |
| Claim | explicit/manual/Git | claim review | evidence-aware context | 不自动 |
| Reasoning | session/task | outcome/feedback | handoff/context | 受 scope 限制 |
| Wiki/Workflow | reviewed workspace | document/commit | task lens | 不自动覆盖 claim |
| Long-term | reviewed promotion | explicit review | durable context | 需要条件 |
| CodeGraph | source refresh | snapshot/provider health | code context | 不复制 source |
| Session/Team | coordination runtime | task/outcome | active handoff | 随生命周期 |

任何新 memory kind 必须先回答“它为什么不属于已有类型”。

#### H. Benchmark 和 evaluation

1.10 必须有真实任务集，而不是只测 conversation recall。初版可以覆盖 20–30
个任务：

- 新项目首次接入；
- 同一项目隔天恢复；
- 从 Claude/Codex/Cursor/Windsurf 等不同 host 切换；
- handoff 后继续任务；
- 旧决策已被新代码替代；
- 两条记忆互相冲突；
- 代码删除后旧记忆仍命中；
- CJK、punctuation、large-store、embedding unavailable；
- poisoned/untrusted memory 诱导模型做错误决策；
- MCP/HTTP session 过期后重新绑定。

每个任务记录：

- 首次正确行动率；
- 恢复成功率；
- memory hit precision/recall；
- stale/conflict rejection rate；
- abstention precision；
- input/output tokens；
- p50/p95 latency；
- SQLite/Orama RSS 和 cold-start；
- fallback 和 degraded 次数；
- 人工 review 成本。

1.10 不能只公布最高 recall。生态已经开始把 token、延迟、质量和成功率放在
一起评估，相关方向可以参考 [Total Recall at What Cost?](https://arxiv.org/html/2608.11879v1)。

#### I. Operator experience

CLI、Dashboard 和 doctor 要能回答：

- 当前记忆库是否健康；
- 哪些来源需要 review；
- 哪些 index 是 stale/degraded；
- 哪些 project/session 未绑定；
- 哪些 memory 是 candidate、legacy、blocked 或 conflict；
- 哪次检索使用了 fallback；
- 自动更新、发布 provenance 和 registry signature 状态；
- 下一步是 refresh、review、repair、archive 还是重新绑定。

### 3.3 1.10 的非目标

- 不把 SQLite 换成 Postgres 或云端主库；
- 不删除 legacy MCP；
- 不新增大量 memory kind；
- 不把 trust score 作为一个不可解释的总分；
- 不把 Dashboard 变成自动修改一切的控制台；
- 不让默认 agent context 变大；
- 不为支持一个 host 复制一套业务 runtime；
- 不把 CodeGraph 变成远程源代码代理；
- 不把 long-term memory 自动注入所有 task。

### 3.4 1.10 验收门槛

- canonical read/write 不依赖 Orama、embedding 或 FTS；
- 所有 derived view 失败都能给出诊断 receipt；
- `micro/lite/team/full` schema 和 tool count 没有非预期变化；
- legacy/modern MCP、stdio/HTTP、session/stateless binding smoke 全通过；
- 19 个集成目标通过 manifest/config parity 检查；
- 40k/100k 数据量、SQLite busy、索引重建和跨项目隔离无回归；
- receipt 的 token 增长有预算；
- poisoning、stale、conflict 场景不会无证据地进入 verified context；
- benchmark 能复现 1.9.11 与 1.10 的差异。

## 4. 1.11：本地优先 relay 与协作预览

1.11 才开始验证 hosted/relay 需求。它必须是 opt-in preview，不能改变默认本地
产品。

### 4.1 Relay 目标

- SQLite 继续是每个本地 project 的 canonical store；
- relay 保存同步日志、远端副本或受控 namespace，不成为默认唯一真相；
- 本地离线可以继续工作；
- 网络恢复后通过 outbox、幂等 key、cursor、重试和冲突记录同步；
- 删除、撤回、归档和 visibility 变化能同步；
- 每个 relay batch 有 schema/version、project/tenant scope、origin、createdAt、
  hash、signature 或至少可验证 checksum；
- 远端错误不得让本地读写伪装成功；
- 远端没有权限时，不返回项目存在性泄漏。

### 4.2 Hosted adapter 的授权模型

Hosted relay 需要区分：

- user principal；
- agent principal；
- project principal；
- organization/tenant principal；
- scope/read/write/admin 权限；
- session/handle；
- audit actor。

一个共享 Bearer token 不足以支撑多租户。项目 handle 必须绑定已认证 principal，
服务器不能接受客户端直接提供的任意文件系统根目录作为授权依据。

### 4.3 External identity integration

外部 agent identity 作为 adapter 或 integration layer 实现：

- Memorix 内部继续负责 team、task、handoff、message、lock 和 project memory；
- 外部 inbox/email/webhook 负责从 CI、scheduler、Slack 或其他系统接收任务；
- 外部系统不直接获得 Memorix team access；
- 入站消息进入 candidate/isolated namespace；
- agent 处理完成后写回结构化 receipt；
- 发送方、接收方、权限和重放都可审计。

### 4.4 1.11 的进入条件

只有当 #313 产生至少一个可公开运行的 reference adapter，且至少 3 个真实用户
愿意试用，才继续扩大 relay。仅有“想要云端”不能证明 hosted backend 值得进入核心。

### 4.5 1.11 验收门槛

- 断网、重试、重复投递、乱序 batch、冲突和撤回全部有确定性测试；
- 同一事件重复同步不会产生重复 memory；
- 不同 user/tenant/project/agent 之间无越权；
- 本地 canonical store 始终可独立运行；
- relay 故障不会把 durable local record 变成空结果；
- 删除和 retention policy 可以传播并审计；
- latency、带宽、磁盘和 provider 成本有明确上限；
- 多 agent handoff 与外部 scheduler 的身份边界可解释。

## 5. 1.12：Agent 生态与开发者平台

1.12 负责让外部贡献者和新 host 能更低成本地接入，不继续把所有适配工作集中在
核心维护者身上。

### 5.1 Integration SDK

提供稳定的 adapter API 和 capability manifest：

- `manifest` 描述能力、版本、文件、transport 和权限；
- generator 生成 MCP config、plugin、hook、rules 和 skills；
- doctor 能检查 manifest 与已安装文件的一致性；
- repair 可以预览、应用、回滚；
- uninstall 能移除 Memorix 生成内容，保留用户内容；
- 每个 host 的版本差异在 manifest 中表达；
- 贡献者只实现 adapter，不重复编写业务 memory 逻辑。

### 5.2 Progressive disclosure 和 tool profiles

- profile 继续控制默认 MCP 工具面；
- agent 可以发现 capability，但只加载当前 task 需要的 schema；
- skills、workflow 和 reference docs 采用分层加载；
- receipt 记录实际加载了哪些工具和文档；
- 对大型工具面增加 token budget 和 discover latency 指标；
- 不因为“工具很多”而默认开放 full profile。

### 5.3 社区和分发

- 完成 #297 awesome-list 外部提交；
- MiniMax M3.1 Flash 的 provider/model 生态更新已通过 PR #344 合并；
  该更新保留旧模型 lookup 兼容性，并只纳入有证据的 direct/OpenRouter 路径；
- 增加官方 integration examples 和安全边界说明；
- 发布可复现 benchmark 和结果生成脚本；
- 发布包 provenance、SBOM、checksum 和支持矩阵；
- 对每个新 agent host 提供 setup、doctor、repair、uninstall 示例；
- 把社区反馈转成公开 RFC，而不是直接写成临时 feature。

### 5.4 Agent protocol 边界

1.12 可以研究 MCP 与外部 agent-to-agent 通道的组合，但不把 A2A、email、webhook
或第三方 inbox 直接变成 Memorix 核心依赖。所有外部协议必须通过可替换 adapter
进入，并明确：

- authentication；
- authorization；
- replay protection；
- message size；
- source/evidence；
- failure/retry；
- deletion；
- audit。

## 6. 条件式 2.0：远程多租户 Memory Platform

2.0 不是时间到了就发布，而是公共契约真的需要重置时才启动。

### 6.1 2.0 的可能范围

如果产品战略最终变成“远程多用户 memory platform”，2.0 才可以考虑：

- remote canonical store；
- tenant/user/project/agent principal；
- server-side project identity；
- signed sync/event log；
- formal conflict resolution；
- scoped tool authorization；
- new MCP v2 public result contract；
- old MCP bridge as a separately versioned compatibility package；
- migration tooling for observations、sessions、team state、long-term evidence、
  CodeGraph snapshots and derived indexes；
- hosted dashboard、audit、retention、export、delete and compliance controls。

### 6.2 启动 2.0 的硬条件

满足一项硬条件，或同时满足两项中等条件，才启动 RFC：

1. 云端成为默认 canonical authority；
2. 新的 MCP/session/project binding contract 无法用 adapter 兼容；
3. ID、scope、visibility、evidence 或 retention 语义必须破坏性迁移；
4. 连续两个版本周期中，兼容性维护超过工程投入的 35–40%，且仍有用户可见回归；
5. 新 host 已无法表达为现有 adapter capability；
6. 真实用户已经持续使用 relay，并且 hosted isolation、auth、billing、deletion
   和 offline semantics 都有数据支撑。

单纯因为 `server.ts` 很大、SQLite 表很多、集成数量多，不能作为 2.0 理由。

### 6.3 2.0 的迁移原则

- 先发布 compatibility/read-only bridge，再切换写入；
- 先做 dry-run migration、hash comparison、rollback and repair；
- 旧版本可以读取迁移后的新数据，至少保留一个支持窗口；
- derived view 全部可重建；
- source/evidence/provenance 不可在迁移中丢失；
- 用户必须能导出本地 canonical data；
- 远程服务删除与本地删除必须有明确的最终一致性说明；
- 不把自动迁移隐藏在普通启动过程中。

## 7. 横跨所有版本的工程主线

### 7.1 质量与测试

每个实现任务按 RED → GREEN → REFACTOR：

- 先写失败测试；
- 让测试只覆盖本次行为；
- 实现最小修复；
- 运行 focused tests；
- 运行对应 integration pipeline；
- 最后运行 lint/build/full suite。

每个版本必须保留：

- unit tests；
- store → search → detail pipeline；
- MCP stdio/HTTP smoke；
- cross-project isolation；
- failure/degraded/rebuild tests；
- Windows/macOS/Linux matrix；
- package smoke；
- release metadata checks。

### 7.2 性能与容量

固定 1k、10k、40k、100k observation fixture，并记录：

- startup/cold-start；
- session bind；
- search p50/p95；
- FTS/Orama/embedding fallback；
- memory RSS；
- SQLite busy/retry；
- index rebuild；
- MCP tool discovery；
- receipt token size；
- HTTP concurrent sessions。

### 7.3 安全与供应链

每个 release 都要记录：

- tag and commit；
- npm version；
- tarball SHA-512/integrity；
- npm registry signature/attestation；
- SBOM 或依赖树；
- `npm audit signatures`；
- package smoke；
- publish workflow URL；
- MCP Registry status；
- 已知安全 issue 的证据状态。

### 7.4 兼容性

每个版本都要更新：

- MCP profile counts；
- tool schema snapshots；
- plugin manifests；
- hook lifecycle matrix；
- `setup/doctor/repair/uninstall`；
- legacy MCP；
- modern MCP；
- Node 20/22/26；
- Windows/macOS/Linux；
- 旧 SQLite schema 和旧 memory metadata。

### 7.5 文档

长期文档的职责固定为：

- [ACTIVE_WORK.md](../ACTIVE_WORK.md)：当前执行状态和交接；
- [DEVELOPMENT.md](DEVELOPMENT.md)：开发与发布门槛；
- [ARCHITECTURE.md](ARCHITECTURE.md)：系统边界和数据流；
- 本路线图：版本主题、依赖、验收和 2.0 触发条件；
- 专项设计文档：复杂 feature 的可演进契约；
- CHANGELOG：已经发布的用户可见变化。

不要为同一个主题创建多个“最终版”“新版”“补充版”文档。

## 8. 版本验收矩阵

| 维度 | 1.9.12 | 1.10 | 1.11 | 1.12 | 2.0 |
|---|---|---|---|---|---|
| 发布安全 | 必须 | 固化 | 继续 | 继续 | 强制 |
| SQLite canonical | 保持 | 保持 | 保持 | 保持 | 可能改变 |
| Memory provenance | 修复发布链 | 统一 receipt/evidence | 远程同步来源 | 生态来源 | 端到端签名 |
| Admission/abstention | 不扩展 | 正式契约 | 跨 relay | 跨 adapter | 多租户策略 |
| Hosted backend | 不做 | RFC/contract | opt-in preview | adapter ecosystem | 可能成为主线 |
| Agent identity | 不做 | scope 定义 | relay principal | external adapter | tenant principal |
| MCP contract | 不变 | 收敛内部边界 | 兼容扩展 | capability registry | 可破坏性重置 |
| Benchmark | 发布门禁 | coding memory baseline | relay latency/failure | ecosystem comparison | production SLO |

## 9. 给 Luna 的执行规范

后续切换到 Luna 模型执行时，每个任务都使用下面的任务包格式：

```text
任务标题：
目标版本：
问题与用户影响：
允许修改的文件范围：
禁止修改的公共契约：
先写哪些失败测试：
实现要求：
验证命令：
完成标准：
已知风险：
交付时必须报告：改动文件、测试结果、未解决问题、下一步。
```

执行规则：

- 主脑先给出任务包，再让 Luna 写代码；
- Luna 只处理一个清晰边界，不能同时重构多个 domain；
- 一个任务一个分支和一组 focused tests；
- 子代理总数最多五个，失败、超时或退出后不自动重开；
- 不为简单检索、简单文档改动或一次命令调用启动子代理；
- Luna 的代码必须经过主脑 review、测试和 diff 检查；
- 未通过测试不能进入下一个依赖任务；
- 未经 release gate，不能创建 tag、发布 npm 或发布 MCP Registry；
- 每个版本完成后回写 ACTIVE_WORK、CHANGELOG、版本文档和项目记忆。

## 10. 当前执行顺序

当前应按以下顺序推进：

1. 完成 1.9.12 release PR 和远程 CI；
2. 发布 1.9.12，并验证 npm、MCP Registry、GitHub Release；
3. 创建 1.10 contract matrix 和 context receipt 设计；
4. 先实现 receipt、provenance、freshness、admission 和 abstention 的内部契约；
5. 再收敛 retrieval facade、runtime binding 和 integration manifest；
6. 用 benchmark 比较 1.9.11、1.9.12 和 1.10；
7. 只有 1.10 的本地可信上下文门槛通过后，才开始 1.11 relay prototype；
8. 只有 relay 有真实用户和清晰授权边界后，才把 1.12 生态平台化；
9. 根据本文件的硬触发条件决定是否启动 2.0 RFC。

这条路线让补丁版本快速完成，也让后续的大版本有清晰的验证结果，不靠版本号
制造进展感。
