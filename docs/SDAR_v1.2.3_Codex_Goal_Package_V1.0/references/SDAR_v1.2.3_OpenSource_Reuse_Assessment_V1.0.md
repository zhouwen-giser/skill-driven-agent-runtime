# SDAR v1.2.3 六个开源仓库源码级复用评估 V1.0

> **评估日期：** 2026-07-22  
> **适用项目：** `zhouwen-giser/skill-driven-agent-runtime`  
> **目标版本：** SDAR v1.2.3  
> **上位设计：** `SDAR_v1.2.3_Best_Implementation_Design_V1.0.md`、`SDAR_v1.2.3_Overall_Design_V1.0.md`  
> **评估对象：**
>
> 1. `google-gemini/gemini-cli`
> 2. `ECNU-ICALK/AutoSkill`
> 3. `langchain-ai/langmem`
> 4. `agentscope-ai/ReMe`
> 5. `zorazrw/agent-workflow-memory`
> 6. `ace-agent/ace`
>
> **结论性质：** 技术复用评估，不构成法律意见。许可证落地前仍需完成第三方软件清单、源文件归属与 NOTICE 检查。

---

# 1. 结论先行

## 1.1 总结

六个仓库没有任何一个可以直接替代 SDAR v1.2.3 的认知规划与知识成长层。

推荐采用：

```text
Gemini CLI
→ 受控源码移植：后台抽取、候选收件箱、安全校验、非阻断启动模式

AutoSkill
→ 算法重写：候选去重、合并、版本、Replay、变异与晋升

LangMem
→ 算法重写：结构化抽取、已有知识 Insert/Update/Delete、合并压缩

ReMe
→ 算法重写：分阶段记忆、混合检索、关系扩展、异步 Job 编排

AWM
→ 算法重写：从相似轨迹归纳抽象工作流/Skill Goal Pattern

ACE
→ 算法重写：Generator/Reflector/Curator、增量 Delta、正反反馈计数
```

最终实现仍必须保持：

```text
PostgreSQL
→ Experience、Task Type、Capability Pattern、Planning Heuristic 权威

BullMQ / Redis
→ 异步 Worker，可重建

SDAR Model Runtime
→ 唯一模型调用入口

LangGraph.js
→ 唯一 Workflow Runtime

v1.2.2 UserGoalPlanController
→ 唯一 User Goal / A2A Terminal Authority
```

## 1.2 总体复用判断

| 仓库 | 推荐级别 | 主要价值 | 代码直接移植 | 算法重写 | 不建议 |
|---|---|---|---:|---:|---|
| Gemini CLI | A | 后台抽取、候选 Inbox、安全 Patch、证据门禁 | 中高 | 中 | 引入整个 CLI/Core |
| AutoSkill | A | 去重合并、版本、SkillEvo Replay/Promotion | 低 | 很高 | Python Runtime、自动发布 Skill |
| LangMem | B+ | Typed Extraction、知识合并、CRUD Change Set | 低 | 高 | LangChain Python Sidecar |
| ReMe | B+ | Capture→Daily→Digest、RRF 检索、关系扩展 | 低 | 高 | File-as-authority、全量 ReMe 服务 |
| AWM | B | Workflow Pattern Induction | 很低 | 中高 | 研究脚本直接上线 |
| ACE | A- | Reflector/Curator、Delta Update、正反反馈 | 低 | 很高 | 自由文本 Playbook 作为权威 |

## 1.3 人日结论

估算前提：

- 1 工程人日 = 8 小时；
- 工程师熟悉 TypeScript、PostgreSQL、BullMQ、LangGraph.js 和 LLM Structured Output；
- 估算只覆盖六个仓库涉及的模块，不覆盖 v1.2.3 全部 Console、A2A、Generic Task Understanding 和 Interactive Planning；
- “净节省”已扣除阅读、改写、测试、许可证登记和 SDAR 架构适配；
- 各仓库存在功能重叠，不可简单相加。

| 仓库 | 独立实现对应机制 | 复用/适配成本 | 净节省人日 |
|---|---:|---:|---:|
| Gemini CLI | 15～21 | 7～11 | **7～10** |
| AutoSkill | 20～28 | 10～15 | **9～13** |
| LangMem | 10～15 | 6～9 | **4～6** |
| ReMe | 13～19 | 8～12 | **5～8** |
| AWM | 7～11 | 4～7 | **3～5** |
| ACE | 12～18 | 7～11 | **5～8** |

独立使用时合计为 33～50 人日，但存在明显重叠。

推荐组合后的**不重复净节省**：

```text
保守：22 人日
合理：27 人日
上限：34 人日
```

其中：

```text
Experience Capture / Candidate Inbox      6～9 人日
Observer / Extractor / Consolidation      5～7 人日
Dedup / Merge / Version                   4～6 人日
Replay / Shadow / Promotion               5～7 人日
Task Type / Workflow Pattern Induction    2～4 人日
Hybrid Retrieval / Progressive Recall     2～4 人日
```

预计可减少六个项目覆盖范围内约 **35%～45%** 的设计与实现工作；折算到整个 v1.2.3，预计节省约 **12%～18%**。

---

# 2. 评估方法

## 2.1 复用等级

### L3：直接移植

满足：

- 与 SDAR 同为 TypeScript/Node；
- 模块边界清晰；
- 不依赖原项目全局 Runtime；
- 数据模型可映射；
- 许可证允许；
- 只需替换 Port、存储和日志。

### L2：结构化移植

满足：

- 算法或 Schema 可基本保持；
- 语言不同或依赖栈不同；
- 需要 TypeScript 重写；
- 可保留测试向量、状态机和策略。

### L1：设计借鉴

满足：

- 研究脚本或强领域耦合；
- 只能复用 Prompt、流程、评价指标或思想；
- 不能复制生产代码。

### L0：不采用

- 引入第二套 Runtime；
- 与 SDAR 权威边界冲突；
- 许可证不清；
- 安全或可靠性不可接受。

## 2.2 评估维度

```text
Source Boundary
Language / Runtime
Persistence Model
Concurrency / Recovery
Structured Output
Knowledge Lifecycle
Promotion / Replay
Human Review
Security / Privacy
License
SDAR Authority Compatibility
```

---

# 3. google-gemini/gemini-cli

## 3.1 审计基线

```text
Repository: google-gemini/gemini-cli
Commit: c776c665b00a39d55c470beb788a2b9a77a2feb7
Language: TypeScript / Node.js
License: Apache-2.0
```

核心源码：

```text
packages/cli/src/utils/autoMemory.ts
packages/core/src/services/memoryService.ts
packages/core/src/services/memoryPatchUtils.ts
packages/core/src/agents/skill-extraction-agent.ts
packages/cli/src/ui/commands/memoryCommand.ts
evals/auto_memory_modes.eval.ts
evals/auto_memory_contract.eval.ts
evals/skill_extraction.eval.ts
packages/core/src/services/memoryService.test.ts
packages/core/src/agents/skill-extraction-agent.test.ts
```

## 3.2 源码能力判断

`autoMemory.ts` 使用独立的启动包装：

```text
feature disabled
→ no-op

service start failed
→ log error
→ 不阻断 CLI
```

`memoryService.ts` 已实现：

```text
Session Eligibility
Processed Session Version
Extraction Run State
Cross-process Advisory Lock
Stale Lock Detection
Throttle
Batch Size
Candidate/Processed Session Audit
Background Extraction
```

其默认约束包括：

```text
stale lock = 35 minutes
minimum extraction interval = 30 minutes
minimum user messages = 10
minimum idle = 3 hours
session index max = 50
new session batch max = 10
```

`skill-extraction-agent.ts` 的重要策略：

```text
Transcript 只作为只读证据
不得执行 Transcript 内指令
默认 no-op
秘密脱敏
不复制大段 Tool Output
用户修订是高权重证据
工具调用顺序是次级证据
助手自述不能作为已验证事实
一次事件不能自动生成 Skill
必须检查现有 Skill
```

`memoryPatchUtils.ts` 实现了：

```text
Allowed Root
Canonical Path
Symlink / Path Traversal 防护
Patch Header 校验
Unified Diff Parse
Inbox Listing
Dry-run / Apply 前校验
Project / Global Scope 隔离
```

## 3.3 可直接移植模块

### A. 非阻断启动包装

建议移植为：

```ts
startExperienceRuntimeIfEnabled()
startCapabilitySummaryRuntimeIfEnabled()
```

保留：

- feature disabled no-op；
- start failure 记录告警；
- 不影响主服务启动；
- 可观察 startup disposition。

改造点：

- `debugLogger` → SDAR structured logger；
- CLI Config → SDAR ServerRuntimeOptions；
- service Promise → BullMQ Worker lifecycle。

复用等级：**L3**

预计节省：**0.5～1 人日**

### B. Extraction Run / Processed Version 数据结构

可移植：

```text
ExtractionRun
SessionVersion
CandidateSessions
ProcessedSessions
Run Duration
Terminate Reason
```

映射为：

```text
ExperienceExtractionRun
EpisodeRevision
CandidateEpisodeRefs
ProcessedEpisodeRefs
ModelInvocationRefs
```

不能继续使用 JSON State File，应保存到 PostgreSQL。

复用等级：**L2/L3**

预计节省：**1～1.5 人日**

### C. Eligibility / Throttle / Batch 策略

可直接保留算法形态：

```text
eligible source revision
not processed
not currently leased
minimum signal
batch bound
attempt count bound
```

替换：

```text
session message count
→ Episode Completeness / Planning Interaction Signal Count

idle time
→ Terminal committed / Plan Revision settled
```

复用等级：**L2**

预计节省：**1～1.5 人日**

### D. Candidate Inbox 模型

不建议保留文件 Inbox，但可移植状态模型和操作语义：

```text
candidate
reviewed
applied
discarded
invalid
```

映射为：

```text
knowledge_candidate
knowledge_candidate_revision
knowledge_review_action
knowledge_status_transition
```

复用等级：**L2**

预计节省：**1.5～2.5 人日**

### E. Patch 安全校验

对以下功能可直接移植：

```text
Task Type Package Export
Skill Package Proposal
Planning Knowledge Markdown Export
```

尤其可复用：

- canonical path；
- allowlist root；
- unified diff header；
- path traversal；
- dry-run；
- patch hunk validation。

不应把 Patch 作为数据库知识变更权威。

复用等级：**L3**

预计节省：**1.5～2 人日**

### F. Extraction Prompt Hygiene 与 Evals

可移植：

- Evidence-only；
- Transcript Injection 防御；
- Secret Redaction；
- Default No-op；
- Recurrence 门禁；
- User Correction Signal Priority；
- Validated Procedure Requirement；
- Existing Knowledge Dedup Requirement。

复用等级：**L2**

预计节省：**1.5～2 人日**

## 3.4 必须重写

```text
Filesystem Conversation Scan
→ PostgreSQL Runtime Fact / Outbox

Session JSON/JSONL
→ GoalExperienceEpisode

.extraction.lock
→ PostgreSQL Lease + BullMQ Job Identity

.extraction-state.json
→ experience_job / consumer_cursor

Unified Diff Candidate
→ Typed KnowledgeCandidate

MEMORY.md / GEMINI.md
→ MemoryService Active Projection

SkillExtractionAgent LocalExecutor
→ SDAR ModelRuntimeService

CLI /memory inbox
→ Management API + Console

private/global
→ task/user/tenant/global_candidate
```

必须新增 Gemini CLI 不具备的：

- supportCount；
- contradictionCount；
- Episode Authority；
- Task Type；
- Capability Pattern；
- Promotion Evidence；
- Shadow Planning；
- UserGoalPlanValidator 回退；
- 高风险人工门禁。

## 3.5 语言适配

```text
TypeScript → TypeScript
```

适配难度：**低到中**

不能直接导入 Gemini Core 包，因为会带入：

- Config；
- LocalAgentExecutor；
- ResourceRegistry；
- PolicyEngine；
- MessageBus；
- Storage；
- CLI 文件模型。

最佳方式：

```text
选择性复制小型独立算法
+
在 THIRD_PARTY_NOTICES 记录来源
+
改写 Port
+
保留 Apache Header
```

## 3.6 许可证

Apache-2.0。

直接复制时必须：

- 保留版权与许可证头；
- 标记源文件已修改；
- 分发许可证；
- 检查并合并 NOTICE；
- 不使用 Google 商标暗示背书。

## 3.7 人日

```text
独立实现：15～21
适配成本：7～11
净节省：7～10
```

## 3.8 最终建议

```text
采用：
- non-blocking service start
- extraction eligibility
- run state DTO
- candidate inbox lifecycle
- patch/path validation
- extraction hygiene/evals

不采用：
- full Gemini Core
- filesystem authority
- direct active memory edits
```

---

# 4. ECNU-ICALK/AutoSkill

## 4.1 审计基线

```text
Repository: ECNU-ICALK/AutoSkill
Commit: 94c47ca488d4ba4117d20272e66d49b9877e68cf
Language: Python >= 3.9
License claim: README badge says MIT
License risk: inspected commit has no root LICENSE file; pyproject has no license field
```

核心源码：

```text
autoskill/management/extraction.py
autoskill/management/maintenance.py
autoskill/management/identity.py
autoskill/management/formats/agent_skill.py
autoskill/management/stores/*
autoskill/offline/conversation/prompts.py
autoskill/offline/trajectory/prompts.py

SkillEvo/runner.py
SkillEvo/replay_builder.py
SkillEvo/evals.py
SkillEvo/mutators.py
SkillEvo/models.py
SkillEvo/registry.py
```

## 4.2 源码能力判断

`maintenance.py` 明确实现：

```text
Vector Similarity
+ Name Similarity
+ Signal Overlap
→ Same Capability Gate

Candidate
→ discard / merge / add

Merge
→ Heuristic / LLM-assisted
→ Version Bump
→ Preserve Resources
→ Regenerate SKILL.md
```

能力身份判断考虑：

- job-to-be-done；
- deliverable class；
- target audience；
- evaluation criteria；
- recent-intent boundary；
- topic switch；
- instance-specific entity removal；
- uncertain 时默认不合并。

`SkillEvo/runner.py` 实现：

```text
Build Replay Samples
→ Compile Eval Rules
→ Split mutate_dev / promotion_test
→ Evaluate Baseline
→ Generate Variants
→ Evaluate Candidates
→ Compare Champion
→ Promotion Gate
→ Persist Champion + Provenance
```

晋升条件包含：

- 最小 Replay 样本；
- Candidate 平均分必须超过 Champion 最小增量；
- Hard Failure 不能变差；
- 不足样本进入 incubating；
- 保存 outputs、judgments、summary 和 provenance。

## 4.3 可直接移植模块

由于核心是 Python，“直接移植”主要指 Schema、规则、测试向量和 Prompt，不建议复制运行代码。

### A. Candidate 决策枚举

可直接采用：

```text
discard
improve
merge
create
```

SDAR 扩展为：

```text
discard
merge
create_revision
create_new
request_more_evidence
send_to_manual_review
```

复用等级：**L2**

预计节省：**0.5～1 人日**

### B. Capability Identity Scoring

保留算法：

```text
semantic similarity
+ normalized name overlap
+ description/tag/trigger overlap
+ deterministic confidence bands
+ optional LLM judge
```

映射为：

```text
Task Type Identity
Planning Heuristic Identity
Capability Pattern Identity
```

复用等级：**L2**

预计节省：**2～3 人日**

### C. Recent Intent Boundary / De-identification Prompt

可用于用户规划修订归纳：

```text
先识别用户是否切换目标
再判断是同一 Task Type Revision 还是新 Task Type
先移除具体设备、项目、地点和时间
再判断可复用性
```

复用等级：**L2**

预计节省：**1～1.5 人日**

### D. Lineage / Champion 模型

映射：

```text
Skill Lineage
→ Knowledge Lineage

Champion
→ Active Knowledge Version

Variant
→ Candidate Revision
```

复用等级：**L2**

预计节省：**1.5～2 人日**

### E. Replay Split 与 Promotion Metrics

直接采用：

```text
development/mutation samples
promotion holdout samples
baseline/champion comparison
hard-failure non-regression
minimum score delta
insufficient replay = incubating
```

映射到：

```text
Understanding Replay
Planning Replay
Shadow Planning
Promotion Test
```

复用等级：**L2**

预计节省：**3～4 人日**

### F. 报告和 Provenance 结构

可复用输出结构：

```text
run_id
lineage
baseline
champion
candidate variants
sample outputs
judgments
promotion
replay counts
provenance
```

复用等级：**L2**

预计节省：**1～1.5 人日**

## 4.4 必须重写

```text
Python SkillStore
→ PostgreSQL Knowledge Repository

SKILL.md Authority
→ Typed Domain Authority + optional export

Auto add/merge
→ Candidate + Promotion Gate

Skill Identity
→ TaskType/CapabilityPattern/Heuristic specific identity

Conversation/Trajectory
→ GoalExperienceEpisode

LLM factory
→ SDAR Model Runtime

Filesystem Champion Registry
→ Immutable DB Version + Status Transition

Replay response generation
→ SDAR Planning Replay Harness
```

必须新增：

- contradictionCount；
- Current Skill Catalog Hash；
- User/Tenant Scope；
- Risk Level；
- Human Approval；
- Policy Version；
- no physical side effects；
- Active Knowledge → MemoryService projection；
- Skill Publication 与 Knowledge Promotion 分离。

## 4.5 语言适配

```text
Python → TypeScript
```

适配难度：**中高**

推荐：

- 保留公式、阈值逻辑、Prompt；
- 使用 Zod 重建 Schema；
- 使用现有 `SkillEvolutionService` 抽象 Replay/Promotion；
- 不引入 Python Sidecar；
- 将 AutoSkill 数据集转成 TS Contract Fixture。

## 4.6 许可证

README 在当前审计 commit 声明 MIT，但：

```text
root LICENSE: 未找到
pyproject license field: 未声明
```

因此建议：

```text
法务确认前：
- 可以借鉴公开思想和重新实现算法；
- 不复制实质性源码；
- 不把 AutoSkill 源文件直接 vendor 进仓库。
```

需要项目维护者补充标准 LICENSE 或提供书面许可后，再按 MIT 执行版权声明保留。

## 4.7 人日

```text
独立实现：20～28
适配成本：10～15
净节省：9～13
```

## 4.8 最终建议

```text
高优先级算法参考：
- maintenance.py identity/merge
- SkillEvo replay split
- champion promotion
- report/provenance

暂不直接复制源码：
- 许可证文件不完整
- Python Runtime 强耦合
```

---

# 5. langchain-ai/langmem

## 5.1 审计基线

```text
Repository: langchain-ai/langmem
Commit: a2d580946465137c89162e67dc0b18108bd4850c
Language: Python >= 3.10
License: MIT
Version at inspected pyproject: 0.0.30
```

核心源码：

```text
src/langmem/knowledge/extraction.py
src/langmem/reflection.py
src/langmem/graphs/semantic.py
src/langmem/prompts/_layers.py
src/langmem/knowledge/tools.py
docs/docs/guides/extract_semantic_memories.md
docs/docs/guides/extract_episodic_memories.md
docs/docs/guides/delayed_processing.md
```

主要依赖：

```text
langchain
langchain-core
langchain-openai
langchain-anthropic
trustcall
langgraph
langgraph-checkpoint
langsmith
```

## 5.2 源码能力判断

`extraction.py` 提供：

### Thread Extractor

```text
Messages
+ Optional Pydantic Schema
+ Instructions
→ Structured Summary
```

### MemoryManager

```text
Current Messages
+ Existing Memories
→ Insert / Update / Delete
→ Multi-step Consolidation
→ Typed Result
```

其 Memory Prompt 强调：

- semantic/procedural/episodic；
- novelty；
- compare/update；
- redundant consolidation；
- incorrect memory removal；
- induction/abduction；
- confidence；
- persistence and surprise；
- high signal-to-noise。

## 5.3 可直接移植模块

### A. Typed Extractor API

映射为：

```ts
interface ExperienceExtractor<T> {
  id: string;
  schema: ZodType<T>;
  instructions: string;
  extract(input: EpisodeView): Promise<ExtractionResult<T>>;
}
```

保留：

- 任意 Schema；
- 独立 Extractor；
- Structured Output；
- failure isolation。

复用等级：**L2**

预计节省：**1.5～2 人日**

### B. Existing Knowledge Change Set

采用：

```text
insert
update
delete
done
```

SDAR 改为：

```text
create_candidate
create_revision
suggest_supersede
suggest_reject
no_change
```

Model 只生成 Suggestion，Repository 不直接执行。

复用等级：**L2**

预计节省：**1～1.5 人日**

### C. Multi-step Consolidation Loop

可复用：

```text
bounded max_steps
existing knowledge feedback
tool result acknowledgment
early Done
```

复用等级：**L2**

预计节省：**1～1.5 人日**

### D. Memory Instruction Baseline

适用于 ExperienceReflector Prompt：

- 新信息优先；
- 冗余压缩；
- 错误移除；
- 可信度；
- 反常模式；
- 不重复现有知识。

复用等级：**L1/L2**

预计节省：**0.5～1 人日**

## 5.4 必须重写

```text
LangChain Runnable
→ SDAR Application Service

Pydantic
→ Zod / JSON Schema

trustcall
→ SDAR generateStructured

LangGraph Store
→ PostgreSQL Repository

AnyMessage
→ GoalExperienceEpisode

Memory Insert/Update/Delete
→ Candidate Knowledge Suggestion

Generic Memory
→ Heuristic / Task Type / Capability Pattern
```

必须新增：

- Episode Source Authority；
- support/contradiction；
- immutable version；
- Promotion；
- Human Review；
- Scope/Tenant；
- Replay/Shadow；
- risk；
- planning usage evidence。

## 5.5 语言适配

```text
Python + LangChain
→ TypeScript + SDAR Model Runtime
```

适配难度：**中**

不推荐 Python Sidecar，因为：

- LangMem 依赖 LangChain Python 和 LangGraph Store；
- SDAR 已有 LangGraph.js；
- 会形成模型调用、存储和 tracing 双栈。

## 5.6 许可证

MIT。

复制或翻译实质性代码时保留：

- MIT Copyright；
- Permission Notice。

## 5.7 人日

```text
独立实现：10～15
适配成本：6～9
净节省：4～6
```

## 5.8 最终建议

```text
采用：
- Typed Extractor interface
- existing knowledge change-set
- bounded consolidation
- reflection prompt principles

不采用：
- LangChain Python runtime
- LangGraph Store authority
```

---

# 6. agentscope-ai/ReMe

## 6.1 审计基线

```text
Repository: agentscope-ai/ReMe
Commit: 46adb5ae1e94715ecdffe201a46933fbd419a5e1
Language: Python >= 3.11
License: Apache-2.0
Development status: Beta
```

核心源码和配置：

```text
reme/config/default.yaml

reme/steps/index/search.py
reme/steps/index/vector_search.py
reme/steps/index/bm25_search.py
reme/steps/index/node_search.py
reme/steps/index/_dedup.py

reme/components/file_graph/base_file_graph.py
reme/components/file_graph/local_file_graph.py
reme/components/file_graph/nx_file_graph.py
reme/components/file_graph/neo4j_file_graph.py

reme/components/file_store/*
reme/components/file_catalog/*
reme/steps/evolve/*
reme/steps/common/*
reme/steps/index/*
```

## 6.2 源码能力判断

ReMe 当前架构：

```text
session/resource
→ daily
→ digest
→ recall
```

自动 Job：

```text
auto_memory
auto_resource
auto_index
auto_dream
proactive
```

`default.yaml` 将 Job 定义为：

```text
job
→ ordered steps
→ background / cron / base
→ dispatch child steps
```

`search.py` 实现：

```text
Vector Search
+ Keyword Search
→ parallel execution
→ Reciprocal Rank Fusion
→ min score
→ per-tool-context seen dedupe with TTL
→ wikilink expansion
→ result metadata
```

关键默认值：

```text
RRF K = 60
max candidates = 200
default vector weight = 0.7
candidate multiplier = 5
link expansion = enabled
```

## 6.3 可直接移植模块

### A. Capture → Daily → Digest 分阶段语义

映射：

```text
Raw Runtime Facts
→ GoalExperienceEpisode
→ ExperienceObservation
→ Active Knowledge
```

复用等级：**L1/L2**

预计节省：**1～1.5 人日**

### B. Declarative Job/Step 配置思想

SDAR 已有 BullMQ，不需要复制 ReMe Job Runtime，但可采用：

```text
Job Definition
Step Definition
Retry Policy
Cron / Background
Step Result
```

用于 Experience Pipeline 的运维配置。

复用等级：**L1/L2**

预计节省：**0.5～1 人日**

### C. RRF Hybrid Retrieval

可移植算法：

```text
vector rank contribution
+ keyword rank contribution
→ RRF score
```

并扩展：

```text
Task Type structured filter
Capability structured filter
Knowledge scope
Validity interval
```

复用等级：**L2**

预计节省：**1.5～2.5 人日**

### D. Search Context Dedup

可复用：

```text
tool_context_id
seen chunk ids
TTL
avoid repeated injection
```

映射为：

```text
planningSessionId
usedKnowledgeIds
retrievalRevision
```

复用等级：**L2**

预计节省：**0.5～1 人日**

### E. Link Expansion

Task Type/Capability/Heuristic 可保留关系：

```text
related
requires
contradicts
supersedes
supported_by
```

检索后执行一跳或两跳扩展。

复用等级：**L2**

预计节省：**1～1.5 人日**

### F. File/Markdown Projection

可作为：

- 管理端导出；
- Task Type Package；
- Knowledge Review Artifact；
- 版本审计。

不得作为权威。

复用等级：**L1**

预计节省：**0.5 人日**

## 6.4 必须重写

```text
Markdown File Authority
→ PostgreSQL Typed Authority

daily/digest directories
→ Episode/Observation/Knowledge tables

FastAPI/FastMCP service
→ SDAR Application Ports

ReMe Job Runtime
→ BullMQ Workers

File Graph
→ PostgreSQL relation projection

Generic Memory Search
→ Active Knowledge Retriever

auto_dream
→ ExperienceReflector + Promotion
```

必须新增：

- UserGoal/Plan/Outcome references；
- Knowledge status；
- support/contradiction；
- catalogHash；
- Promotion；
- tenant isolation；
- PII deletion；
- no raw session injection；
- Planner Validator integration。

## 6.5 语言适配

```text
Python / FastAPI / FastMCP
→ TypeScript / Express / BullMQ / PostgreSQL
```

适配难度：**中高**

可选 Sidecar 方案不推荐用于产品主线。若团队希望快速进行算法实验，可以暂时使用 ReMe 独立服务作为离线实验基线，但实验结果不得成为 SDAR 权威。

## 6.6 许可证

Apache-2.0。

直接复用需要：

- 保留许可证与版权；
- 标记修改；
- NOTICE 检查；
- 第三方依赖单独审计。

ReMe 的可选依赖包含 Claude Agent SDK、OpenAI Codex、FAISS、Neo4j 等；不应因参考检索算法而将整套 optional dependencies 引入 SDAR。

## 6.7 人日

```text
独立实现：13～19
适配成本：8～12
净节省：5～8
```

## 6.8 最终建议

```text
采用：
- staged memory lifecycle
- RRF retrieval
- context dedupe
- link expansion
- declarative pipeline ideas

不采用：
- ReMe as core service
- file authority
- Python/FastMCP runtime
```

---

# 7. zorazrw/agent-workflow-memory

## 7.1 审计基线

```text
Repository: zorazrw/agent-workflow-memory
Commit: 8c0ff8cd11d648c8fceb99e4e42f37e3b75381b1
Language: Python
License: Apache-2.0
Nature: Research implementation
```

核心源码：

```text
mind2web/offline_induction.py
mind2web/online_induction.py
mind2web/memory.py
mind2web/pipeline.py
mind2web/prompt/*
mind2web/utils/data.py

webarena/induce_prompt.py
webarena/induce_rule.py
webarena/workflow/*
webarena/pipeline.py
```

## 7.2 源码能力判断

`offline_induction.py`：

```text
Training Examples
→ domain/subdomain/website grouping
→ format examples
→ LLM workflow induction
→ filter workflows
→ save text
```

`memory.py`：

```text
Workflow Memory
+ Concrete Exemplars
→ domain/subdomain/website matching
→ sampled examples
→ token budget packing
→ agent prompt
```

其关键思想不是代码框架，而是：

```text
从多个具体轨迹移除实例上下文
→ 提取公共子程序
→ 在相似任务中注入公共工作流和少量示例
```

## 7.3 可直接移植模块

### A. Hierarchical Grouping

映射：

```text
domain
subdomain
website
```

为：

```text
task domain
task type candidate
capability fingerprint
goal pattern fingerprint
```

复用等级：**L2**

预计节省：**0.5～1 人日**

### B. Workflow Induction Prompt

可转换为 Task Type Induction Prompt：

```text
从多个 Goal/Plan 中抽象：
- 典型 Skill Goal
- 依赖
- 可变参数
- 必需 Criterion
- 不适用条件
```

复用等级：**L1/L2**

预计节省：**1～1.5 人日**

### C. Abstract Workflow + Concrete Exemplars

Planner 注入可采用：

```text
1 个 Active Task Type Pattern
+ 1～3 个匹配 Episode Example
```

并受 Token Budget 限制。

复用等级：**L1/L2**

预计节省：**0.5～1 人日**

### D. Offline / Online 双模式

映射：

```text
Offline:
批量历史 Episode 归纳

Online:
当前 Goal 完成后产生 Candidate
```

复用等级：**L1**

预计节省：**0.5 人日**

### E. Evaluation Dataset 结构

可用于 Task Type Replay：

```text
request
trajectory
expected workflow
step success
final success
token usage
```

复用等级：**L1**

预计节省：**0.5～1 人日**

## 7.4 必须重写

几乎所有产品代码都必须重写：

```text
OpenAI direct call
→ SDAR Model Runtime

pickle/json/text
→ PostgreSQL

website-specific hierarchy
→ Generic Task Type Domain

plaintext workflow
→ TaskTypeDefinition / SkillGoalPattern

random exemplar sampling
→ scored deterministic retrieval

research metric
→ SDAR Planning Replay Metric

script main()
→ Application Service + Worker
```

必须新增：

- Zod Schema；
- immutable version；
- support/contradiction；
- negative examples；
- Promotion；
- tenant scope；
- human approval；
- safety；
- capability summary；
- Goal Contract authority。

## 7.5 语言适配

```text
Research Python scripts
→ TypeScript Application Services
```

适配难度：**高**

主要复用 Prompt 和测试思想，不建议复制实现代码。

## 7.6 许可证

Apache-2.0。

即使许可证允许，源码生产化程度低，仍建议 clean-room style 的 TypeScript 重写并记录算法来源。

## 7.7 人日

```text
独立实现：7～11
适配成本：4～7
净节省：3～5
```

## 7.8 最终建议

```text
采用：
- hierarchical grouping
- workflow abstraction prompt
- abstract pattern + concrete exemplar
- offline/online induction

不采用：
- research pipeline runtime
- random sampling
- plaintext workflow authority
```

---

# 8. ace-agent/ace

## 8.1 审计基线

```text
Repository: ace-agent/ace
Commit: bcb7cea0504afad6f55fec4845dd4864c9f9eee7
Language: Python >= 3.10
License: Apache-2.0
Version: 0.1.0
```

主要依赖：

```text
faiss-cpu
openai
together
sambanova
scikit-learn
sentence-transformers
tiktoken
```

核心源码：

```text
ace/ace.py
ace/ace_batch.py
ace/core/generator.py
ace/core/reflector.py
ace/core/curator.py
ace/core/bulletpoint_analyzer.py
ace/prompts/*
playbook_utils.py
logger.py
EXTENDING_ACE.md
```

## 8.2 源码能力判断

ACE 主循环：

```text
Generator
→ 使用 Playbook 生成结果

Reflector
→ 分析结果与环境反馈
→ 标记 Bullet helpful / harmful / neutral

Curator
→ 生成 ADD / UPDATE / MERGE / DELETE / CREATE_META
→ 校验 JSON
→ 记录 Diff
→ 应用增量操作

Evaluation
→ 保存最佳 Playbook
```

Playbook Bullet：

```text
stable ID
helpful count
harmful count
content
section
```

`Reflector` 支持有或无 Ground Truth，并输出使用项的正负标签。

`Curator`：

- 接收当前 Playbook、Reflection、Question Context、Token Budget 和 Stats；
- 生成结构化操作；
- 校验操作；
- 操作失败时跳过并继续；
- 记录每次操作 Diff；
- 不因 Curator 错误终止训练。

## 8.3 可直接移植模块

### A. Generator / Reflector / Curator 分工

映射：

```text
ExperienceObserver
→ 提取事实

ExperienceReflector
→ 评价现有知识对结果的作用

KnowledgeCurator
→ 生成候选 Delta
```

复用等级：**L2**

预计节省：**1～1.5 人日**

### B. Helpful / Harmful Counter

映射为：

```text
supportCount
contradictionCount
acceptedUseCount
rejectedUseCount
improvedOutcomeCount
regressedOutcomeCount
```

注意：SDAR 不能仅凭 LLM 标签更新计数，必须有 Episode/Outcome 引用。

复用等级：**L2**

预计节省：**1～1.5 人日**

### C. Delta Operation Model

采用：

```text
ADD
UPDATE
MERGE
DELETE
CREATE_META
```

SDAR 改为建议操作：

```text
CREATE_CANDIDATE
CREATE_REVISION
SUGGEST_MERGE
SUGGEST_SUPERSEDE
SUGGEST_REJECT
ADD_EVIDENCE
ADD_CONTRADICTION
```

复用等级：**L2**

预计节省：**1.5～2 人日**

### D. Curator Failure Isolation

直接采用：

```text
invalid JSON
empty response
operation error
→ log
→ no-op
→ continue
```

复用等级：**L2**

预计节省：**0.5 人日**

### E. Token Budget / Pruning 思路

用于 Active Knowledge Progressive Disclosure：

```text
knowledge token budget
merge redundancy
prune harmful/deprecated
preserve unique details
```

复用等级：**L1/L2**

预计节省：**0.5～1 人日**

### F. Pre/Post Evaluation

可用于 Shadow Planning：

```text
baseline plan
candidate-knowledge plan
→ compare
→ save best only after gate
```

复用等级：**L2**

预计节省：**1～1.5 人日**

## 8.4 必须重写

```text
Free-text Playbook
→ Typed Knowledge Definitions

Reasoning Trace
→ Displayable Decision/Evidence Summary

Ground Truth Answer
→ User Goal Outcome / Validator / User Correction

LLM Bullet Tags
→ Referenced Promotion Evidence

Immediate Curator Apply
→ Candidate Delta + Deterministic Validator

File Best Playbook
→ Immutable Active Knowledge Version

Provider-specific LLM clients
→ SDAR Model Runtime
```

必须新增：

- Episode refs；
- Knowledge scope；
- risk；
- human approval；
- replay；
- Skill Catalog invalidation；
- PlanningUsageRecord；
- contradiction lifecycle；
- PostgreSQL CAS；
- no automatic execution authority。

## 8.5 语言适配

```text
Python
→ TypeScript
```

适配难度：**中高**

ACE 代码组织清晰，但模型调用、日志、评估和 Playbook 格式均与 SDAR 不同。推荐保留角色分工、操作 Schema 和评价指标，重写运行代码。

## 8.6 许可证

Apache-2.0。

可复制或改写时应：

- 保留版权/许可证；
- 标记修改；
- NOTICE 检查；
- 记录源 commit。

## 8.7 人日

```text
独立实现：12～18
适配成本：7～11
净节省：5～8
```

## 8.8 最终建议

```text
采用：
- reflector/curator separation
- helpful/harmful evidence categories
- typed delta operations
- curator no-op on error
- pre/post evaluation

不采用：
- free-text playbook authority
- reasoning traces
- immediate automatic curation
```

---

# 9. 跨仓库能力映射

## 9.1 Experience Capture

推荐来源：

```text
Gemini CLI:
- Eligibility
- Non-blocking start
- Run state
- Candidate Inbox
- Security hygiene

ReMe:
- Capture → Daily → Digest staging
- Background Job configuration
```

SDAR 实现：

```text
Transactional Outbox
→ Episode Builder
→ Observer Queue
→ Candidate Knowledge Inbox
```

## 9.2 Observer / Extractor

推荐来源：

```text
LangMem:
- Typed Extractor
- Existing Memory Change Set
- Bounded consolidation

Gemini CLI:
- Evidence-only prompt
- User correction priority
- no-op gate

ReMe:
- staged compression
```

SDAR 实现：

```text
GoalExperienceEpisode
→ independent typed extractors
→ ExperienceObservation
```

## 9.3 Reflector / Curator

推荐来源：

```text
ACE:
- Reflector/Curator separation
- helpful/harmful
- delta operations

LangMem:
- compare/update/delete

AutoSkill:
- identity and merge gate
```

SDAR 实现：

```text
Observation Batch
→ Reflection
→ Candidate Delta
→ Deterministic Validator
→ Candidate Version
```

## 9.4 Task Type Induction

推荐来源：

```text
AWM:
- workflow abstraction
- offline/online induction
- abstract workflow + concrete exemplar

AutoSkill:
- job-to-be-done identity
- recent intent boundary
- de-identification
```

SDAR 实现：

```text
Episode Cluster
→ Task Type Candidate
→ Recognition/Dimensions/Criteria/Goal Patterns
```

## 9.5 Promotion

推荐来源：

```text
AutoSkill SkillEvo:
- lineage/champion
- mutate_dev/promotion_test
- hard-failure non-regression

ACE:
- pre/post evaluation
- positive/negative use counts

Gemini CLI:
- human candidate inbox
```

SDAR 实现：

```text
Candidate
→ Replay
→ Shadow Planning
→ Support/Contradiction
→ Human Review
→ Active
```

## 9.6 Retrieval

推荐来源：

```text
ReMe:
- Vector + BM25 RRF
- relation expansion
- session-level seen dedupe

AWM:
- abstract workflow + concrete examples
```

SDAR 实现：

```text
Structured Filter
+ pgvector
+ PostgreSQL full-text/BM25-like rank
+ RRF
+ relation expansion
+ Progressive Disclosure
```

---

# 10. 代码落地建议

## 10.1 可进入 Vendor/Port 流程

只建议从 Gemini CLI 选择性移植以下小型边界：

```text
memoryPatchUtils:
- canonical target resolution
- allowlist
- patch headers
- path traversal
- inbox validation

memoryService:
- extraction run DTO
- processed revision logic
- eligibility strategy
- stale lease ideas

autoMemory:
- non-blocking startup wrapper
```

落地路径建议：

```text
third_party/intake/gemini-cli-auto-memory-<commit>.md
third_party/sources.lock.yaml
packages/application/src/experience/*
packages/domain/src/knowledge-candidate.ts
```

不要 vendor 整个文件后再大量修改；优先抽取 50～200 行独立、可测试的算法。

## 10.2 Clean-room TypeScript 重写

以下全部采用重写：

```text
AutoSkill maintenance + SkillEvo
LangMem MemoryManager
ReMe search/job semantics
AWM induction
ACE reflector/curator
```

重写流程：

```text
1. 写出 Source Behavior Test
2. 用 SDAR Domain 定义输入输出
3. 重新实现 TypeScript
4. 使用独立 Fixtures 验证行为
5. 记录算法来源，不复制原 Prompt 长文
```

## 10.3 不采用 Python Sidecar

第一版不建议：

```text
SDAR Node
→ HTTP
→ Python LangMem/ReMe/AutoSkill/ACE
```

原因：

- 双部署；
- 双模型调用；
- 双日志；
- 双配置；
- 双安全边界；
- 双故障恢复；
- 数据一致性困难；
- Python 服务可能成为第二知识权威；
- v1.2.3 不需要毫秒级上线，TypeScript 重写收益更高。

Python Sidecar 仅适用于：

```text
离线基准实验
对照评估
Prompt/算法验证
```

不能进入产品 Release Gate。

---

# 11. 许可证矩阵

| 仓库 | 许可证 | 直接复制建议 | 义务/风险 |
|---|---|---|---|
| Gemini CLI | Apache-2.0 | 可以，选择性 | 保留头、标记修改、LICENSE/NOTICE |
| AutoSkill | README 声称 MIT；根目录 LICENSE 缺失 | 暂不复制 | 先取得标准 LICENSE 或书面确认 |
| LangMem | MIT | 可以 | 保留版权与许可文本 |
| ReMe | Apache-2.0 | 可以，但不建议跨语言复制 | 保留头、标记修改、LICENSE/NOTICE |
| AWM | Apache-2.0 | 可以，但建议 clean-room 重写 | 研究代码，记录算法来源 |
| ACE | Apache-2.0 | 可以，但建议结构化重写 | 保留头、标记修改、LICENSE/NOTICE |

## 11.1 第三方登记

建议新增：

```text
docs/13_OPEN_SOURCE_LICENSE_LEDGER.md
third_party/sources.lock.yaml
THIRD_PARTY_NOTICES.md
```

每项记录：

```yaml
name:
repository:
commit:
pathsReviewed:
pathsCopied:
reuseType: copied | translated | algorithm_reference | prompt_reference
license:
noticeRequired:
modifications:
tests:
owner:
```

---

# 12. 推荐实施顺序

## Step 1：Gemini Candidate Infrastructure

交付：

- Experience job state；
- PostgreSQL lease；
- Candidate Inbox；
- review actions；
- failure-isolated worker；
- source authority；
- redaction；
- API/Console Skeleton。

预计：**8～11 人日**

其中复用节省：**6～8 人日**

## Step 2：Typed Observer

来源：

```text
LangMem + Gemini
```

交付：

- Extractor Port；
- 10 个 typed extractors；
- bounded multi-step；
- failure isolation；
- observation schema。

预计：**8～12 人日**

复用节省：**4～6 人日**

## Step 3：Identity / Merge / Curator

来源：

```text
AutoSkill + ACE
```

交付：

- fingerprint；
- semantic/lexical score；
- LLM identity judge；
- candidate delta；
- merge/supersede；
- positive/negative evidence。

预计：**10～14 人日**

复用节省：**7～10 人日**

## Step 4：Task Type Induction

来源：

```text
AWM + AutoSkill
```

交付：

- deterministic clustering；
- abstract Goal Pattern；
- concrete Episode exemplars；
- negative examples；
- Candidate Task Type。

预计：**7～10 人日**

复用节省：**3～5 人日**

## Step 5：Retrieval

来源：

```text
ReMe
```

交付：

- structured filter；
- vector + text；
- RRF；
- relationship expansion；
- session dedupe；
- progressive disclosure。

预计：**6～9 人日**

复用节省：**3～5 人日**

## Step 6：Replay / Shadow / Promotion

来源：

```text
AutoSkill SkillEvo + ACE + Gemini Inbox
```

交付：

- replay dataset；
- baseline/champion；
- mutate_dev/promotion_test；
- non-regression；
- shadow planning；
- manual promotion；
- provenance report。

预计：**11～16 人日**

复用节省：**7～10 人日**

---

# 13. 最终推荐组合

## 13.1 必选

```text
Gemini CLI:
Candidate Inbox / Extraction Worker / Security

AutoSkill:
Identity / Merge / Lineage / Replay Promotion

ACE:
Reflector / Curator / Delta / Helpful-Harmful
```

这三者决定知识是否能安全形成和晋升。

## 13.2 建议选

```text
LangMem:
Typed Extraction / Consolidation

ReMe:
RRF / Link Expansion / Staged Memory
```

这两者提升经验质量和召回质量。

## 13.3 专项采用

```text
AWM:
Task Type / Skill Goal Pattern Induction
```

仅用于任务类型归纳，不作为通用 Runtime。

---

# 14. 最终架构落点

```text
Gemini Extraction Infrastructure
        │
        ▼
GoalExperienceEpisode
        │
        ▼
LangMem-style Typed Observer
        │
        ▼
ACE-style Reflector + Curator
        │
        ▼
AutoSkill-style Identity / Merge / Lineage
        │
        ├── AWM-style Task Type Induction
        │
        └── Capability Pattern / Heuristic Induction
        │
        ▼
AutoSkill SkillEvo-style Replay / Promotion
        │
        ▼
Active Knowledge
        │
        ▼
ReMe-style Hybrid Retrieval / Relation Expansion
        │
        ▼
v1.2.3 Task Understanding / User Goal Planning
```

所有模块都必须包在 SDAR 权威边界中：

```text
经验候选
≠ 用户目标

任务类型
≠ Skill

能力模式
≠ 当前 Readiness

经验建议
≠ Plan Admission

Workflow completed
≠ User Goal achieved
```

---

# 15. 最终决策

## 可以直接移植

```text
Gemini CLI：
- 小型 TypeScript 安全和调度算法
- Candidate Inbox 操作模式
- Evals/Test Cases
```

## 应重写后复用

```text
AutoSkill：
- Identity/Merge
- Lineage/Champion
- Replay/Promotion

LangMem：
- Typed Extraction
- Consolidation Change Set

ReMe：
- RRF Retrieval
- Relation Expansion
- Staged Pipeline

AWM：
- Workflow Induction

ACE：
- Reflector/Curator
- Delta Operations
- Positive/Negative Counters
```

## 不应引入

```text
任何完整 Python Runtime
任何文件型知识权威
任何自动发布高风险 Skill 的路径
任何直接读取私有 reasoning trace 的经验提取
任何未经 Promotion 的 Candidate Planner 注入
```

## 预计收益

```text
不重复净节省：22～34 人日
推荐计划值：27 人日

六仓库覆盖范围节省：35%～45%
整个 v1.2.3 节省：12%～18%
```

最优策略不是“拼接六个开源项目”，而是：

```text
从 Gemini 移植基础设施
从 AutoSkill 提取身份与晋升算法
从 LangMem 提取结构化归纳
从 ReMe 提取检索与分阶段记忆
从 AWM 提取任务模式归纳
从 ACE 提取增量反思和策展
最终全部重建在 SDAR 的 TypeScript、PostgreSQL 和 v1.2.2 权威之上
```

---

# 附录 A：源码审计索引

## Gemini CLI

```text
c776c665b00a39d55c470beb788a2b9a77a2feb7
packages/cli/src/utils/autoMemory.ts
packages/core/src/services/memoryService.ts
packages/core/src/services/memoryPatchUtils.ts
packages/core/src/agents/skill-extraction-agent.ts
```

## AutoSkill

```text
94c47ca488d4ba4117d20272e66d49b9877e68cf
autoskill/management/maintenance.py
autoskill/offline/conversation/prompts.py
autoskill/offline/trajectory/prompts.py
SkillEvo/runner.py
SkillEvo/replay_builder.py
SkillEvo/evals.py
SkillEvo/mutators.py
```

## LangMem

```text
a2d580946465137c89162e67dc0b18108bd4850c
src/langmem/knowledge/extraction.py
src/langmem/reflection.py
src/langmem/graphs/semantic.py
src/langmem/prompts/_layers.py
```

## ReMe

```text
46adb5ae1e94715ecdffe201a46933fbd419a5e1
reme/config/default.yaml
reme/steps/index/search.py
reme/steps/index/vector_search.py
reme/steps/index/bm25_search.py
reme/utils/link_expansion.py
reme/components/file_graph/*
```

## AWM

```text
8c0ff8cd11d648c8fceb99e4e42f37e3b75381b1
mind2web/offline_induction.py
mind2web/online_induction.py
mind2web/memory.py
webarena/induce_prompt.py
webarena/induce_rule.py
```

## ACE

```text
bcb7cea0504afad6f55fec4845dd4864c9f9eee7
ace/ace.py
ace/core/generator.py
ace/core/reflector.py
ace/core/curator.py
ace/core/bulletpoint_analyzer.py
playbook_utils.py
```
