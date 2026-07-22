# SDAR v1.2.3 详细实施方案 V1.0

## 经验驱动的能力认知、泛型任务理解、人机协同规划与受控知识成长

> **文档状态：** Detailed Implementation Plan Candidate  
> **目标版本：** SDAR v1.2.3  
> **适用仓库：** `zhouwen-giser/skill-driven-agent-runtime`  
> **前置版本：** SDAR v1.2.2 User Goal Planning Runtime  
> **输入文档：** Upgrade Requirements V0.1、Best Implementation Design V1.0、Overall Design V1.0、Open Source Reuse Assessment V1.0  
> **当前仓库事实：** Node/TypeScript/pnpm Monorepo；PostgreSQL、BullMQ、LangGraph.js、A2A、Zod/AJV；现有 Memory、Skill Evolution、Management OpenAPI、A2A TCK、SBOM 与 Sources Lock  
> **实现原则：** 不引入第二套 Agent/Workflow/Memory Runtime；不阻断 v1.2.2；只将 Confirmed Contract/Plan 交给 v1.2.2。  
> **估算口径：** 人日为工程估算，不含组织审批等待；已计入六仓库建议复用后的净节省。

---

# 1. 实施结论

v1.2.3 按“在线认知规划链”和“离线知识成长链”并行建设，最终在 Planner Injection 处汇合：

```text
在线：
User Request
→ Generic Task Understanding
→ Interactive Goal Contract
→ Interactive Skill Goal Plan
→ Confirmed Contract/Plan
→ v1.2.2 Execute/Judge/Recover

离线：
v1.2.2 Runtime Facts
→ Outbox / GoalExperienceEpisode
→ Observer / Typed Extractors
→ Reflector / Curator
→ Candidate Task Type / Capability Pattern / Heuristic
→ Replay / Shadow / Human Promotion
→ Active Knowledge
→ Planning Retriever
```

**不可改变的权威边界：**

```text
用户确认 Contract       = 意图权威
Skill Registry/Outcome  = 声明能力权威
Provider Readiness      = 当前可执行性权威
SkillGoalPlanValidator  = 计划准入权威
Outcome Judge           = 完成权威
UserGoalPlanController  = User Goal / A2A Terminal 权威
Experience              = Advisory Input
```

# 2. 开工前置与不阻断策略

## 2.1 v1.2.2 接口冻结点

- `UserGoalCompletionContract`、`UserGoalPlan`、`SkillGoalDefinition`、`SkillOutcomeSpecification` 已冻结。
- Runtime Fact、Terminal Outcome、Progress、Recovery、Business Event Impact 可通过 Repository/Outbox 读取。
- `UserGoalPlanningService` 与 `SkillGoalPlanValidator` 有稳定 Port。
- `MemoryService` 和 `SkillEvolutionService` 的边界可重构但不可改变现有运行权威。

## 2.2 可提前并行的工作

- G00 可立即执行。
- G01 可在 Skill Outcome Specification Schema 冻结后执行。
- G07 可先完成 Outbox/Job/Episode Skeleton，激活等待 v1.2.2 Terminal Fact 完成。
- G03 可用人工 Task Type Fixture，不等待经验学习。

## 2.3 禁止阻断 v1.2.2

- v1.2.2 不引用 Experience Repository、Task Type Registry 或 Capability Pattern。
- Feature Flag 关闭时，v1.2.2 启动、规划、执行、恢复和 A2A 行为必须完全可用。
- Observer、Reflector、Promotion 不进入 Goal Lock，不进入 A2A Terminal Transaction。

# 3. 技术基线与代码落点

```text
apps/
├── server                 # Runtime composition、Feature Flag、Worker lifecycle
└── console                # Understanding/Plan/Experience/Capability/Task Type UI

packages/
├── domain                 # 全部 Cognitive Domain、状态机、错误码、Invariant
├── application            # Capability、Understanding、Session、Episode、Observer、Promotion、Retriever
├── persistence-postgres   # Repository、事务、CAS、Lease、Outbox、Projection
├── runtime-redis          # BullMQ Queue/Worker/Reconciler；非权威
├── model-provider-adapter # 新 Model Stage 走现有 ModelRuntimeService
├── a2a-adapter            # Agent Card、input-required、interaction metadata
├── management-api         # OpenAPI、Actions、Governance API
└── langgraph-runtime      # 继续作为唯一 Workflow Runtime；v1.2.3 不新建执行 Runtime

schemas/                   # JSON Schema / Golden Fixtures
infra/postgres/            # v1.2.3 Migration Batch
scripts/                   # verify、replay、source lock、SBOM、acceptance
third_party/               # 来源锁和移植说明，不放完整 Python Runtime
```

## 3.1 建议 Domain 目录

```text
packages/domain/src/cognitive/
├── capability.ts
├── capability-card.ts
├── task-understanding.ts
├── interactive-goal.ts
├── interactive-planning.ts
├── planning-correction.ts
├── experience.ts
├── observation.ts
├── task-type.ts
├── capability-pattern.ts
├── planning-heuristic.ts
├── promotion.ts
├── knowledge-usage.ts
├── cognitive-events.ts
├── cognitive-errors.ts
└── index.ts
```

## 3.2 建议 Application 目录

```text
packages/application/src/cognitive/
├── capability-summary-builder.ts
├── capability-card-publisher.ts
├── cognitive-entry-router.ts
├── generic-task-understanding-service.ts
├── missing-dimension-question-service.ts
├── interactive-goal-session-service.ts
├── interactive-planning-session-service.ts
├── interactive-plan-patch-service.ts
├── planning-correction-service.ts
├── goal-experience-episode-builder.ts
├── experience-observer-service.ts
├── experience-extractor-pipeline.ts
├── experience-reflector-service.ts
├── task-type-induction-service.ts
├── capability-pattern-induction-service.ts
├── knowledge-promotion-service.ts
├── planning-knowledge-retriever.ts
├── experience-enriched-planner.ts
└── ports.ts
```

# 4. 分阶段实施路线

| 阶段 | 名称 | Goals | 退出结果 |
|---|---|---|---|

| P0 | 架构冻结 | G00 | 完成 Domain、ADR、状态机、Port、Schema、许可证和来源锁。 |

| P1 | 能力认知 | G01～G02 | 生成确定性 Capability Summary 与公开 A2A Card。 |

| P2 | 在线人机规划 | G03～G06 | 完成泛型理解、Goal Contract、Plan Review 和用户修订事实。 |

| P3 | 经验采集与观察 | G07～G08 | 完成 Outbox/Episode、Observer 和 Typed Extractors。 |

| P4 | 知识候选归纳 | G09～G11 | 完成 Reflector、Task Type 和 Capability Pattern Candidate。 |

| P5 | 晋升与反哺 | G12～G14 | 完成 Promotion、Retrieval、Progressive Disclosure 和 Planner Fallback。 |

| P6 | 产品集成与评估 | G15～G16 | 完成 API/Console/A2A、Replay 和 Shadow Harness。 |

| P7 | 硬化发布 | G17 | 完成安全、容量、恢复、灰度和发布证据。 |


依赖关系：

```text
G00
├── G01 → G02
│   └── G03 → G04 → G05 → G06
└── G07 → G08 → G09
                 ├── G10
                 └── G11

G09 + G10 + G11 → G12 → G13 → G14
G02 + G04 + G05 + G06 + G07 + G12 + G14 → G15
G03 + G05 + G08 + G12 + G14 → G16
G00～G16 → G17
```

关键路径：

```text
G00 → G07 → G08 → G09 → G10/G11 → G12 → G13 → G14 → G15/G16 → G17
```

# 5. Goal 级详细实施

## G00：需求冻结、ADR 与 Domain Skeleton

**阶段：** P0  
**依赖：** v1.2.2 关键 Domain/Port 已稳定；无 v1.2.3 Goal 依赖  
**估算：** 7～10 人日  
**开源复用：** Gemini CLI 源码接收流程；六仓库来源锁与许可证台账  
**代码落点：** `docs/`、`schemas/`、`packages/domain`、`packages/application`、`packages/persistence-postgres`、`scripts/`  
**数据落点：** 仅建立 DDL Skeleton、Enum/状态字典和迁移占位；不激活产品行为


### 实施任务

1. 批准 KD-01～KD-20，并建立 ADR 编号、责任人和替代关系。

2. 冻结 Experience、Capability、Task Understanding、Interactive Session、Knowledge Promotion 的 Domain Schema。

3. 定义 Candidate/Active、Declared/Observed/Validated、task/user/tenant/global_candidate 等术语。

4. 建立所有状态机、错误码、Reason Code、Source Authority 和数据分类。

5. 定义 Cognitive Runtime Ports，确保 `domain` 不依赖 `application/persistence/a2a`。

6. 建立 Feature Flag、Model Stage、Outbox Event、Queue Name 和 Correlation ID 常量。

7. 建立第三方来源锁：仓库、commit、审计路径、reuseType、许可证和 NOTICE 义务。

8. 新增架构检查，禁止 v1.2.2 Runtime 反向依赖 Experience/Task Type/Capability Pattern。

9. 制定开发态数据库重置规则：不迁移未发布实验数据，但保留 v1.2.3 内部不可变版本语义。


### 测试

- Domain factory/validator 单元测试。

- 状态机允许/禁止迁移 Contract Test。

- 架构依赖扫描。

- Schema Golden Fixture。

- 许可证和 sources lock 检查。


### 完成判定

- 全部 Domain/Schema/状态机通过评审。

- 不存在产品行为和外部副作用。

- 所有后续 Goal 的输入输出都能引用已冻结类型。


---

## G01：Runtime Capability Summary Builder

**阶段：** P1  
**依赖：** G00；v1.2.2 `SkillVersion`、`SkillUsageSpecification`、`SkillOutcomeSpecification` 可读取  
**估算：** 6～8 人日  
**开源复用：** Codex/Agent Skills 的 Progressive Disclosure 思想；不引入外部 Runtime  
**代码落点：** `packages/domain`、`packages/application`、`packages/persistence-postgres`、`apps/server`  
**数据落点：** `runtime_capability_summary`、`runtime_capability_summary_item`、`runtime_capability_limitation`


### 实施任务

1. 实现 `CapabilityCatalogSnapshotBuilder`，按精确 Skill Version 收集权威声明。

2. 定义 Canonical JSON 和排序规则，生成稳定 `catalogHash`。

3. 实现 Capability、Domain、Effect、Evidence、Artifact、Context、Mode、Task Type 和 Composition 聚合。

4. 实现 Capability Limitation：缺 Outcome、仅内部、需确认、不可组合、无 Enabled Skill 等。

5. 实现 Active Summary Pointer 和按 Hash 幂等重建。

6. 订阅 Skill Enable/Disable、Version、Outcome Specification、Visibility 和 Composition 变化。

7. 构建 Level-0 Capability Index 与 Level-1 Detail，Level-2 Exact Skill 延迟到 Skill Selection。

8. 实现 Cache 和 Hash-matched Snapshot 读取；禁止写入动态 Readiness。


### 测试

- 同一 Skill 集合生成相同 Hash 的 Property Test。

- 输入顺序变化不影响 Hash。

- Skill 版本/可见性变化必然改变 Hash。

- Summary 不包含 Provider 当前状态。

- 并发重建只激活一个匹配 Snapshot。


### 完成判定

- Capability Summary 完全确定性，不依赖 LLM。

- P95 Cache Hit 目标≤50ms。

- 可由 Planner 通过 Index→Detail 渐进加载。


---

## G02：Public Capability Card 与 A2A Projection

**阶段：** P1  
**依赖：** G01  
**估算：** 5～7 人日  
**开源复用：** A2A Agent Card 现有实现；Gemini/Agent Skills 的可审查能力描述思想  
**代码落点：** `packages/a2a-adapter`、`packages/application`、`packages/persistence-postgres`、`packages/management-api`、`apps/console`  
**数据落点：** `public_capability_card_snapshot`


### 实施任务

1. 实现 Public Visibility Allowlist，不使用 Denylist。

2. 由 Runtime Capability Summary 生成 Public Capability Profile。

3. 生成稳定顶层 Description；LLM Narrative 仅作为可选展示产物。

4. Narrative 失败时使用确定性模板。

5. 实现 `catalogHash + generationPolicyVersion` 绑定和 Active Card Pointer。

6. 将当前 `skills[]` 投影保留为 Enabled Public Skill 明细。

7. 增加可选 `io.sdar/capabilityProfile` Extension。

8. A2A 请求只读取已激活 Snapshot，不在请求时调用 Model。


### 测试

- Card 不含 Tool、Provider、Credential、Workflow、内部 Skill、用户经验和实时资源。

- Hash 不匹配时拒绝激活。

- Narrative 失败仍可服务 Agent Card。

- A2A Baseline/TCK 不回归。


### 完成判定

- Agent Card 动态反映当前公开能力。

- Public Card 与 Summary 事务一致。

- 隐私审计通过。


---

## G03：Generic Task Understanding

**阶段：** P2  
**依赖：** G00、G01；初始 Task Type 使用人工 Fixture  
**估算：** 9～12 人日  
**开源复用：** Claude Code Plan Mode 的只读理解；LangMem Typed Extraction  
**代码落点：** `packages/domain`、`packages/application`、`packages/persistence-postgres`、`packages/model-provider-adapter`  
**数据落点：** `generic_task_understanding`、`generic_task_understanding_dimension`


### 实施任务

1. 实现 `CognitiveEntryRouter`，区分明确任务和泛型任务。

2. 实现 `GenericTaskUnderstandingService` 和 `task_understanding` Model Stage。

3. 定义 Task Type Candidate、Capability Requirement、Known Constraint、Missing Dimension、Assumption。

4. 实现 Blocking/Conditional/Non-blocking Dimension 分类。

5. 实现 target、scope、time_range、criteria、artifact、evidence、side_effect_authorization 等首批维度。

6. 加载 Capability Index、人工 Task Type Index 和低风险 User Preference。

7. 实现高风险授权不明时的 `confirmation_required`。

8. 将外部文本包裹为数据，防止 Prompt Injection。

9. 保存 Understanding Revision、Source Refs、Policy Version、Model Invocation 和 State Hash。


### 测试

- 模糊任务进入 Understanding。

- 明确任务可直接形成 Contract Candidate。

- 缺目标、范围和标准时召回正确维度。

- 安全授权缺失不会被经验静默填充。

- 结构化输出非法时有界重试。


### 完成判定

- 能够输出四种 disposition。

- Task Type 只辅助理解，不覆盖用户表达。

- P95 目标≤3s（不含用户等待）。


---

## G04：Interactive Goal Session

**阶段：** P2  
**依赖：** G03  
**估算：** 8～11 人日  
**开源复用：** Claude Code Plan Mode、多轮反馈和 Permission Mode 交互范式  
**代码落点：** `packages/domain`、`packages/application`、`packages/persistence-postgres`、`packages/a2a-adapter`  
**数据落点：** `interactive_goal_session`、`interactive_goal_turn`、`goal_contract_candidate`


### 实施任务

1. 实现 UNDERSTAND→GOAL_REVIEW 状态机。

2. 实现 `MissingDimensionQuestionService`，按信息增益选择问题。

3. 每轮绑定 Dimension、Criterion、阻断原因、Understanding Version。

4. 支持 answer、accept、patch、reject、restart_understanding、cancel。

5. 用户回答后创建新的 Understanding Revision，不修改旧版本。

6. 实现 Candidate User Goal Completion Contract 生成和 Diff。

7. 实现 `sessionId + expectedVersion + idempotencyKey` CAS。

8. 映射 A2A `input-required` 和 `io.sdar/interaction` Metadata。

9. 设置 maxClarificationRounds、maxContractRevisions 和 elapsed budget。


### 测试

- 并发回答只有一个成功，冲突返回最新 Snapshot。

- 重复 idempotencyKey 不重复写入。

- 已回答维度不重复询问。

- 达到预算后停止。

- 未确认 Contract 不进入 Planning。


### 完成判定

- 能够有界形成并确认 Goal Contract。

- 用户 Patch 优先于 Task Type、经验和默认策略。

- Session 可在重启后恢复。


---

## G05：Interactive Planning Session 与 Plan Patch Compiler

**阶段：** P2  
**依赖：** G01、G04；v1.2.2 User Goal Planner/Validator Port 已稳定  
**估算：** 10～14 人日  
**开源复用：** Claude Code Plan 编辑；Codex Goal Steering；现有 v1.2.2 Plan Validator  
**代码落点：** `packages/domain`、`packages/application`、`packages/persistence-postgres`、`packages/a2a-adapter`、`packages/langgraph-runtime`（只复用，不建第二 Runtime）  
**数据落点：** `interactive_planning_session`、`interactive_planning_turn`、`user_goal_plan_candidate`


### 实施任务

1. 实现 PLAN_REVIEW 状态机。

2. 调用基础 User Goal Planner 生成 Candidate Skill Goal DAG。

3. 实现自然语言→Structured Patch Model Stage。

4. 支持增删 Skill Goal、修改 Goal、依赖、优先级、并行、Coverage 和确认策略。

5. Patch 先经 Patch Schema/权限校验，再生成新不可变 Candidate Version。

6. 每个 Candidate 重新执行 DAG、Bounds、Coverage、Capability Shape、Policy、Side Effect、No Replay 校验。

7. 实现 Plan Diff 和 Experience Hint 展示字段。

8. 仅 Confirmed Candidate 可交接给 v1.2.2；交接使用 `goalId+goalVersion` 锁。

9. 实现 manual_all、manual_risky、auto_validated、never_auto 策略，但高风险始终人工。


### 测试

- 环依赖、孤立依赖和超限 DAG 被拒绝。

- Criterion Coverage 缺失被拒绝。

- 未确认不创建 SkillAttempt、不调用 MCP。

- Plan Patch P95 目标≤5s。

- 重启恢复当前 Candidate。


### 完成判定

- 用户可查看、修改、拒绝和确认计划。

- 每次修改均版本化、可解释、可验证。

- v1.2.2 只收到 Confirmed Contract/Plan。


---

## G06：Planning Correction Facts 与 Interaction Episode

**阶段：** P2  
**依赖：** G04、G05  
**估算：** 6～8 人日  
**开源复用：** Gemini Auto Memory 的 User Correction 高权重；Claude Auto Memory 的作用域思想  
**代码落点：** `packages/domain`、`packages/application`、`packages/persistence-postgres`  
**数据落点：** `planning_correction_fact`、`planning_interaction_episode`


### 实施任务

1. 记录 Understanding、Contract、Plan 的 Before/User Instruction/Patch/After/Validation。

2. 实现 correctionType 首批分类。

3. 关联 accepted/rejected、最终 Outcome 和后续反例。

4. 区分 task_scoped、user_scoped、tenant_scoped、global_candidate。

5. 低风险 User Preference 可进入现有 Memory Projection；安全/授权类禁止。

6. 生成 Interaction Episode Hash 和完整度。

7. 为 Task Type/Heuristic Induction 提供确定性 Fingerprint 输入。


### 测试

- 一次用户修订不会自动全局化。

- 同一修订重复提交幂等。

- 最终 Outcome 补齐后生成新 Revision。

- 用户删除请求可传播到 scoped projection。


### 完成判定

- 所有用户修订可追踪到前后版本和最终结果。

- 学习流程不依赖私有思维链。


---

## G07：Experience Outbox、Job 与 Goal Episode

**阶段：** P3  
**依赖：** G00；v1.2.2 Runtime Fact 和 Terminal Event 已冻结  
**估算：** 9～12 人日  
**开源复用：** Gemini CLI 后台抽取、Eligibility、Run State、失败隔离；选择性 TypeScript Port  
**代码落点：** `packages/domain`、`packages/application`、`packages/persistence-postgres`、`packages/runtime-redis`、`apps/server`  
**数据落点：** `cognitive_runtime_outbox`、`cognitive_runtime_consumer_cursor`、`experience_job`、`goal_experience_episode`、`goal_experience_episode_source`、`experience_dead_letter`


### 实施任务

1. 在 v1.2.2 事实提交事务中写 Outbox，不在主链同步调用 Observer。

2. 实现 Episode Eligibility：Contract、Current Plan、User Goal Judgment 和 Authority 完整。

3. 实现 PostgreSQL Lease、attempt、backoff、dead letter 和 reconciler。

4. 实现 Episode Builder，组装 Plan Revision、Attempt、Outcome、Progress、Recovery、Event Impact 和 Interaction。

5. 实现 Redaction、Source Kind、Completeness、Episode Hash 和不可变 Revision。

6. 实现 at-least-once Worker + Handler Idempotency。

7. Redis 丢失后从 PostgreSQL Job/Outbox 重建。

8. 引入 Gemini CLI 小型安全/调度算法时登记源 commit、修改说明和 Apache NOTICE。


### 测试

- Goal Terminal 后异步创建 Episode。

- 同一事实重复投递不重复 Episode。

- 缺关键事实进入拒绝/等待，不生成默认经验。

- Worker 崩溃、Redis 清空、PostgreSQL 重启后恢复。

- Episode 不包含凭据和私有思维链。


### 完成判定

- Experience Capture 不影响 A2A Terminal 延迟和成功率。

- Episode Event 不丢失。

- Dead Letter 可人工重放。


---

## G08：Experience Observer 与 Typed Extractors

**阶段：** P3  
**依赖：** G07  
**估算：** 9～12 人日  
**开源复用：** LangMem Typed Extractor/Consolidation；Gemini Evidence-only/No-op/Redaction  
**代码落点：** `packages/domain`、`packages/application`、`packages/persistence-postgres`、`packages/model-provider-adapter`、`packages/runtime-redis`  
**数据落点：** `experience_observation`、`experience_observation_fact`、`experience_extraction`


### 实施任务

1. 定义通用 `ExperienceExtractor<T>` Port 和独立失败语义。

2. 实现 GoalPattern、TaskTypeSignal、Decomposition、Dependency、Criterion、Evidence、Artifact、Capability、Failure、Recovery、NoProgress、HumanCorrection Extractor。

3. Observer 输入按 Contract/Plan/Attempt/Outcome/Recovery/Correction 分区。

4. 输出区分 fact、inference、candidate_lesson、uncertainty、contradiction。

5. 实现 bounded multi-step Consolidation，已有 Observation 只能生成变更建议。

6. 实现 Batch、Token/Byte Budget、Fast/Reasoning Model 分级。

7. 模型输出经 Zod/AJV、引用存在性、长度、枚举和注入清洗。

8. Extractor 单项失败不使整个 Observation 失败。


### 测试

- 12 个 Extractor 的 Schema Golden Test。

- 单个 Extractor 失败其余仍保存。

- Transcript 指令不会被当作系统指令。

- 无足够证据时输出 no-op。

- Observer 重试和 Dead Letter。


### 完成判定

- Observation 可追踪到 Episode 和 Model Invocation。

- 不生成无来源 Candidate。

- 后台失败不影响在线任务。


---

## G09：Experience Reflector、Identity 与 Knowledge Curator

**阶段：** P4  
**依赖：** G08  
**估算：** 8～11 人日  
**开源复用：** ACE Reflector/Curator/Delta；AutoSkill Identity/Merge；LangMem Change Set  
**代码落点：** `packages/domain`、`packages/application`、`packages/persistence-postgres`、`packages/model-provider-adapter`  
**数据落点：** `experience_reflection`、通用 Candidate/Delta 记录（或各知识表的 candidate revision）


### 实施任务

1. 实现 Generator/Reflector/Curator 分工，不保存原始 reasoning trace。

2. Reflector 评价知识对 Outcome、用户接受和 Validator 的 helpful/harmful/neutral 影响。

3. 实现语义相似度、名称/标签/目标重叠、Recent Intent Boundary 和去实例化 Identity。

4. Curator 只输出 CREATE_REVISION、SUGGEST_MERGE、SUGGEST_SUPERSEDE、ADD_EVIDENCE、ADD_CONTRADICTION、NO_CHANGE。

5. 所有 Delta 经确定性校验，模型不得直接应用 Active Knowledge。

6. 实现 Candidate Fingerprint、Duplicate Search、Merge/Supersede Lineage。

7. 无效 JSON、空结果和操作错误均 no-op 并继续。

8. Reflection 按 tenant、goalPattern、capabilityFingerprint、时间窗口分批。


### 测试

- 同一 Job-to-be-done 合并，不同交付物/标准拆分。

- 具体设备、地点、日期去除后仍能判断复用边界。

- 低置信度 Identity 默认不合并。

- Curator 非法 Delta 不改变数据。

- 正反证据均保留。


### 完成判定

- Reflector 只能创建 Candidate/Revision。

- Candidate Lineage 可追踪。

- 反例不会被压缩丢失。


---

## G10：Task Type Induction

**阶段：** P4  
**依赖：** G06、G09  
**估算：** 8～11 人日  
**开源复用：** AWM Workflow Induction；AutoSkill Job-to-be-done Identity 和 Recent Intent Boundary  
**代码落点：** `packages/domain`、`packages/application`、`packages/persistence-postgres`  
**数据落点：** `task_type_definition`、`task_type_evidence`


### 实施任务

1. 构建多维 Fingerprint：语义目标、Criteria、Artifact、Capability、DAG Shape、Correction、Outcome。

2. 先确定性聚类，再由 Model 命名、归纳和生成 Negative Examples。

3. 输出 Recognition、Required/Optional Dimensions、Criteria Template、Capability Requirement、Goal Pattern、Dependency Pattern。

4. 支持 Offline Batch 和 Online Candidate 两种模式。

5. 保存抽象 Task Type + 1～3 个具体 Episode Exemplars。

6. 一次 Episode 不创建 Active Task Type。

7. Task Type 与当前用户约束冲突时由 Applicability Guard 剔除。


### 测试

- 相似目标但不同完成标准不会错误合并。

- 不同表述可识别同一 Task Type Candidate。

- Negative Example 能阻止误匹配。

- 人工 Fixture 与归纳 Candidate 可并存。


### 完成判定

- 生成版本化 Candidate Task Type。

- 未晋升 Candidate 不影响正式 Understanding。


---

## G11：Capability Pattern Induction 与 Gap Candidate

**阶段：** P4  
**依赖：** G01、G09  
**估算：** 8～11 人日  
**开源复用：** AutoSkill 能力身份；Voyager/Agent Skills 仅作概念参考  
**代码落点：** `packages/domain`、`packages/application`、`packages/persistence-postgres`  
**数据落点：** `capability_pattern_definition`、`capability_pattern_evidence`、`capability_experience_evidence`


### 实施任务

1. 从 Skill Outcome、Attempt、Evidence、Artifact、Correction、Recovery 和 Event Impact 归纳能力模式。

2. 区分 Declared、Observed、Validated Capability。

3. 保存 Applicable Conditions、Effect、Evidence、Artifact、Prerequisite、Dependency、Failure 和 Limitation。

4. 映射精确 Skill Version；映射为空时创建 Capability Gap Candidate。

5. Skill Catalog Hash、Skill Version 或 Policy 变化触发重新验证。

6. Gap 可产生 Skill Authoring Proposal，但不得自动发布 Skill。


### 测试

- Observed Capability 不修改 Skill 声明。

- 过去成功不绕过当前 Readiness。

- Skill Version 变化使相关 Active Pattern 进入 validating。

- 无 Skill 映射正确形成 Gap。


### 完成判定

- Capability Pattern 与 Skill/Readiness 权威分离。

- Gap 可审计、可聚合、不可自动执行。


---

## G12：Knowledge Promotion Framework

**阶段：** P5  
**依赖：** G09、G10、G11；复用现有 Skill Evolution 的通用验证组件  
**估算：** 12～16 人日  
**开源复用：** AutoSkill SkillEvo Lineage/Champion/Replay；ACE 正反计数；Gemini Candidate Inbox  
**代码落点：** `packages/domain`、`packages/application`、`packages/persistence-postgres`、`packages/runtime-redis`  
**数据落点：** `planning_heuristic`、`planning_heuristic_evidence`、`knowledge_promotion_evaluation`、`knowledge_status_transition`


### 实施任务

1. 从现有 Skill Evolution 抽取 Threshold、Duplicate、Replay、Case Runner、Correction Diff 通用组件。

2. 为 Heuristic、Task Type、Capability Pattern 实现独立 Promotion Target Adapter。

3. 实现 candidate→validating→active→deprecated/rejected 状态机和 CAS。

4. 聚合 uniqueGoal、uniqueUser、success/failure、accepted/rejected、replay、shadow、support/contradiction。

5. 实现初始阈值策略和 policyVersion。

6. 高风险候选必须 Replay+Shadow+人工审核+Policy Allow。

7. 新反例、Catalog Hash、Policy、Skill Version 和拒绝率变化触发 active→validating。

8. Active Knowledge 投影到现有 MemoryService，只保存检索摘要与权威引用。

9. Promotion 与 Skill Publication 严格分离。


### 测试

- 单 Episode 无法晋升。

- 阈值、反例比例和风险门禁。

- 一个 Candidate Version 只有一个终态 Evaluation。

- 人工拒绝/修订可追踪。

- Memory Projection 删除后可由权威表重建。


### 完成判定

- 只有 Active Knowledge 可被正式 Retriever 读取。

- 高风险不可自动晋升。

- 不存在 Memory/结构化知识双权威。


---

## G13：Planning Knowledge Retrieval 与 Progressive Disclosure

**阶段：** P5  
**依赖：** G01、G12  
**估算：** 8～11 人日  
**开源复用：** ReMe Vector+Text RRF、Relation Expansion、Context Dedup；Codex Progressive Disclosure  
**代码落点：** `packages/application`、`packages/persistence-postgres`、现有 `MemoryService`/Embedding Repository  
**数据落点：** `experience_usage_record`；复用 Active Knowledge 和 Memory Projection 表


### 实施任务

1. 构建 Query Fingerprint 和结构化 Scope/Status/Applicability/Catalog/Policy Filter。

2. 并行 Vector Recall 与 Text/FTS Recall，使用 RRF 融合。

3. 实现关系一跳扩展：requires、contradicts、supersedes、supported_by、related。

4. 按 Planning Session 记录已使用 Knowledge ID，避免重复注入。

5. Level-0 Index→Top-K Full Definition→Exact Skill 的渐进加载。

6. 实现默认预算：Task Type 3、Capability 8、Heuristic 8、总字符20K。

7. 冲突知识不合并；低置信度和版本不匹配剔除。

8. P95 目标≤500ms。


### 测试

- RRF 排名和结构化过滤。

- 非 Active 知识不可返回。

- 用户/租户作用域隔离。

- 同一 Session 不重复注入。

- 关系扩展受深度和数量限制。


### 完成判定

- 只返回适用 Active Knowledge。

- 检索结果可解释、可重放。

- 上下文预算可控。


---

## G14：Experience-enriched Planning 与 Fallback

**阶段：** P5  
**依赖：** G05、G13  
**估算：** 9～12 人日  
**开源复用：** Mastra Context Projection 思想；Codex/Claude 交互规划；不引入外部 Runtime  
**代码落点：** `packages/application`、`packages/persistence-postgres`、`apps/server`  
**数据落点：** 扩展 `experience_usage_record`，关联 Plan Candidate、用户动作和最终 Outcome


### 实施任务

1. 以 Decorator 包装基础 `UserGoalPlanningService`，不改写基础 Planner 权威。

2. 构建 Task Type、Capability Experience 和 Planning Heuristic Context。

3. 支持 off、shadow、advisory、active 四种 Injection Mode。

4. 经验增强 Plan 先经完整 Validator。

5. 被拒绝时最多一次无经验有界重规划。

6. Experience Repository/Timeout/冲突/低置信度时 fail-open 到基础 Planner。

7. 保存使用了什么、影响哪些 Skill Goal、用户是否接受、Validator/Outcome 结果。

8. 不允许经验修改用户 Contract、安全策略、Readiness 或 Terminal。


### 测试

- 无经验和 Experience DB 故障时基础 Planner 正常。

- 经验 Plan 无效时回退成功。

- Shadow 不影响正式 Task。

- Advisory 必须人工确认。

- Usage Record 可关联最终 Outcome 和反例。


### 完成判定

- 经验反哺可关闭、可灰度、可解释。

- 基础 Planner 仍可独立运行。


---

## G15：Management API、Console 与 A2A 全面集成

**阶段：** P6  
**依赖：** G02、G04、G05、G06、G07、G12、G14  
**估算：** 12～16 人日  
**开源复用：** Gemini Candidate Inbox UI 语义；Claude Plan Review 体验；现有 Management OpenAPI  
**代码落点：** `packages/management-api`、`packages/a2a-adapter`、`apps/console`、`apps/server`  
**数据落点：** 不新增核心权威表；使用审计和现有会话/知识表


### 实施任务

1. 实现 Capability、Understanding、Goal Session、Planning Session、Experience、Knowledge API。

2. 所有写 API 要求 auth、actor、reason、expectedVersion、idempotencyKey。

3. 实现 Task Understanding、Goal Contract Review、Plan DAG Review 页面。

4. 实现 Experience Governance、Capability Cognition、Task Type Governance 页面。

5. 实现 Candidate Promote/Reject/Revalidate/Deprecate 和 Dead Letter Replay。

6. 实现 A2A input-required 的回答/确认路由。

7. 更新 OpenAPI、Console Route、错误展示和审计详情。

8. Console 不允许直接修改 Provider/Outcome/Active Plan。


### 测试

- OpenAPI Contract。

- 权限、CAS、幂等和审计。

- A2A input-required→回答→恢复。

- Console Diff 与后端版本一致。

- Public/Internal 数据隔离。


### 完成判定

- 关键业务可通过 API 和 Console 完成。

- A2A 标准状态无私有扩展枚举。

- 管理操作不产生未授权副作用。


---

## G16：Evaluation、Replay 与 Shadow Harness

**阶段：** P6  
**依赖：** G03、G05、G08、G12、G14  
**估算：** 12～16 人日  
**开源复用：** AutoSkill SkillEvo mutate_dev/promotion_test；ACE pre/post；AWM 轨迹数据结构  
**代码落点：** `evals/` 或 `tests/replay/`、`packages/application`、`scripts/`  
**数据落点：** Replay Dataset/Run/Result 可使用专用测试表或版本化 Artifact；不得写生产 Active Knowledge


### 实施任务

1. 建立 Planning Replay Dataset：request、world summary、accepted contract/plan、patch、outcome、catalogHash、knowledge。

2. 实现 Understanding、Contract、Plan、Injection、Task Type Recognition 和 Gap Replay。

3. 数据分为 mutate_dev 和 promotion_test，防止同数据优化和晋升。

4. Baseline/Champion/Candidate 比较，Hard Failure 不允许退化。

5. 实现 Shadow Planning，输出 improved/neutral/regressed/invalid/unsafe。

6. 构建 Evaluation Metrics：Missing Dimension、Coverage、Patch Count、Attempt、Recovery、Risk、Token/Latency。

7. Replay 使用 No Physical Provider；禁止真实 MCP 副作用。

8. 生成 Promotion Provenance Report。


### 测试

- Replay 确定性和数据隔离。

- Candidate 无样本进入 incubating。

- Hard Failure 退化时拒绝晋升。

- Replay 不修改生产 Skill/Knowledge。


### 完成判定

- 每次 Promotion 都有可复验报告。

- Shadow 结果不影响正式任务。

- 可量化开源算法复用收益。


---

## G17：Hardening、灰度与 Release

**阶段：** P7  
**依赖：** G00～G16  
**估算：** 15～20 人日  
**开源复用：** 现有 `verify`、A2A TCK、SBOM、sources lock 和架构检查流水线  
**代码落点：** 全仓库、`scripts/`、`infra/`、CI、发布文档  
**数据落点：** 全量索引、Retention、清理、重建和容量验证


### 实施任务

1. 完成并发、CAS、幂等、Lease、Outbox、Redis 清空和重启恢复。

2. 完成租户/用户作用域、PII 删除传播、Prompt Injection 和 Public Card 隐私审计。

3. 完成容量、Backpressure、Queue Lag、Model Budget 和 Retention 测试。

4. 实现 Capture→Observe→Candidate→Shadow→Advisory→Active Low-risk 灰度。

5. 默认：Summary/Card on、Understanding ambiguous、Interactive manual、Capture/Observer on、Induction shadow、Promotion manual、Injection shadow。

6. 更新 Architecture、OpenAPI、Acceptance Map、Migration、Source Lock、SBOM 和 THIRD_PARTY_NOTICES。

7. 运行 unit/contract/integration/e2e/A2A TCK/chaos/replay/security。

8. 生成 Release Report，明确 Experience=Advisory、无 Python Sidecar、无自动 Skill 发布。


### 测试

- 40 项总体架构场景和上位需求 50 项核心场景。

- P95 性能目标。

- 跨租户和删除传播。

- Worker/DB/Redis/Model 故障降级。

- 全量 `pnpm verify`。


### 完成判定

- 全部发布门禁通过。

- v1.2.2 原执行链无回归。

- 默认配置不自动启用高风险知识。


---

# 6. 数据库与迁移实施

## 6.1 Migration Batch

| Batch | Goals | 表组 | 原则 |
|---|---|---|---|
| M1 | G01～G02 | Capability Summary/Card | 先 Snapshot 后 Active Pointer；Hash 绑定 |
| M2 | G03～G06 | Understanding/Interactive | 全部不可变 Revision；Session CAS |
| M3 | G07～G09 | Outbox/Episode/Observation | 业务事实与 Outbox 同事务；Worker 幂等 |
| M4 | G10～G14 | Knowledge/Promotion/Usage | Candidate/Active 分离；状态迁移审计 |


迁移编号在 G00 根据 v1.2.2 最终序列分配连续区间，不预先硬编码。开发态允许重置数据库，但必须通过空库、重复运行、重启和最新 Baseline 测试。

## 6.2 核心唯一约束

```text
UNIQUE(goal_id, goal_version, episode_hash)
UNIQUE(source_event_id, handler_id)
UNIQUE(catalog_hash, generation_policy_version)
UNIQUE(task_id) WHERE interactive_goal_session active
UNIQUE(goal_id, goal_version) WHERE interactive_planning_session active
UNIQUE(knowledge_id, version)
UNIQUE(session_id, revision)
UNIQUE(candidate_id, candidate_version, terminal_promotion_evaluation)
```

## 6.3 主要索引

- `goal_experience_episode(tenant_id, goal_id, goal_version, created_at desc)`。
- `experience_observation(status, created_at)` 与 `source_episode_id` GIN/关联索引。
- `task_type_definition(status, tenant_id, version)`、Embedding/FTS Projection。
- `capability_pattern_definition(status, capability, catalog_hash)`。
- `planning_heuristic(status, kind, policy_version)`。
- `experience_usage_record(plan_candidate_id, knowledge_id)` 和 `final_outcome_ref`。
- Outbox `(consumer, status, available_at)`、Lease `(leased_until)`。

## 6.4 事务边界

- Summary/Card：插入 Snapshot→校验 Hash→切 Active Pointer，一个事务。
- Session Action：校验 expectedVersion→写 Turn/Revision→更新 Session，一个事务。
- Goal Terminal：写 Runtime Fact→Outbox，一个事务；Episode 异步。
- Plan Candidate：写 Candidate→Validator Result→ExperienceUsageRecord，一个事务。
- Promotion：CAS Candidate→写 Evaluation/Transition→写 Active Projection，一个事务。

# 7. 事件、队列与 Worker

## 7.1 Domain/Outbox Events

```text
skill.catalog_changed
capability.summary_built
capability.card_published
task.understanding_created
task.clarification_requested
task.clarification_answered
goal.contract_candidate_created
goal.contract_confirmed
plan.candidate_created
plan.revised
plan.confirmed
planning.correction_recorded
user_goal.terminal_committed
experience.episode_created
experience.observation_completed
experience.reflection_completed
knowledge.candidate_created
knowledge.validating
knowledge.promoted
knowledge.rejected
knowledge.contradiction_recorded
planning.knowledge_used
```

事件 Payload 只包含标识、版本、Source Refs 和必要路由字段，不复制大对象；Worker 读取 PostgreSQL 权威对象。

## 7.2 队列

```text
sdar-capability-summary
sdar-capability-card
sdar-experience-episode
sdar-experience-observer
sdar-experience-reflector
sdar-knowledge-promotion
sdar-shadow-planning
```

优先级：在线 Understanding/Session 直接 Application 调用；后台优先级为 Capability→Episode→Observer→Reflector→Promotion→Shadow。Episode 不丢，Shadow 可丢弃过期 Candidate。

# 8. Model Runtime 实施

| Stage | 模型层级 | 输出 | 失败语义 |
|---|---|---|---|
| task_understanding | Reasoning | GenericTaskUnderstanding | 有界重试；不能恢复则 input-required/failed |
| task_clarification | Fast | MissingDimensionQuestion | 使用模板或请求人工 |
| goal_contract_generation | Reasoning | Contract Candidate | 不提交权威 Contract |
| interactive_plan_patch | Reasoning | Structured Plan Patch | 保留当前 Candidate |
| experience_observation | Fast/Reasoning | Observation/Extraction | Retry/Dead Letter |
| experience_reflection | Reasoning | Candidate Delta | No-op on invalid |
| task_type_induction | Reasoning | Candidate Task Type | Candidate only |
| capability_pattern_induction | Reasoning | Candidate Capability Pattern | Candidate only |
| capability_narrative | Fast | Display Narrative | Deterministic template |
| knowledge_promotion_assessment | Reasoning | Assessment Suggestion | Deterministic gate owns status |


所有调用必须包含 `stage/operation/inputSchemaVersion/outputSchema/policyVersion/sourceRefs/correctionErrors`，并通过现有 `ModelRuntimeService` 记录 Invocation。

# 9. 开源复用落地

| 来源 | 复用方式 | 对应 Goals | 禁止事项 |
|---|---|---|---|
| Gemini CLI | 选择性 TypeScript Port | G00、G07、G08、G15 | 不引入整个 Core/CLI，不使用文件为权威 |
| AutoSkill | Clean-room TS 算法重写 | G09、G10、G12、G16 | 许可证澄清前不复制源码；不自动发布 Skill |
| LangMem | Typed Extractor/Change Set 重写 | G08、G09 | 不引入 Python/LangChain Sidecar |
| ReMe | RRF/Link Expansion/Staged Pipeline 重写 | G07、G13 | 不引入 FastAPI/FastMCP 或 File Authority |
| AWM | Workflow Pattern Prompt/Fixture 参考 | G10、G16 | 不使用研究脚本生产运行 |
| ACE | Reflector/Curator/Delta 重写 | G09、G12、G16 | 不保存 reasoning trace，不直接应用 Playbook |


必须更新 `third_party/sources.lock.yaml`、`THIRD_PARTY_NOTICES.md` 和开源许可证台账。AutoSkill 当前只按算法参考处理，直至标准 LICENSE 得到确认。

# 10. API 与 A2A 交付

```text
GET/POST /api/v1/capabilities/*
GET      /api/v1/tasks/{taskId}/understanding*
GET/POST /api/v1/tasks/{taskId}/goal-session*
GET/POST /api/v1/tasks/{taskId}/planning-session*
GET      /api/v1/tasks/{taskId}/planning-interactions
GET/POST /api/v1/experience/*
GET/POST /api/v1/knowledge/*
GET/POST /api/v1/task-types/*
GET/POST /api/v1/capability-patterns/*
```

A2A 继续使用标准 `working/input-required/completed/failed/canceled`；交互 Metadata 只携带 `sessionId/interactionType/questionId/expectedVersion/allowedActions`。

# 11. Feature Flag 与灰度

```text
SDAR_CAPABILITY_SUMMARY_ENABLED
SDAR_CAPABILITY_CARD_ENABLED
SDAR_GENERIC_TASK_UNDERSTANDING_ENABLED
SDAR_INTERACTIVE_GOAL_ENABLED
SDAR_INTERACTIVE_PLANNING_ENABLED
SDAR_EXPERIENCE_CAPTURE_ENABLED
SDAR_EXPERIENCE_OBSERVER_ENABLED
SDAR_EXPERIENCE_REFLECTION_ENABLED
SDAR_TASK_TYPE_INDUCTION_ENABLED
SDAR_CAPABILITY_INDUCTION_ENABLED
SDAR_KNOWLEDGE_PROMOTION_ENABLED
SDAR_EXPERIENCE_INJECTION_MODE=off|shadow|advisory|active
```

| 灰度 | 行为 | 发布用途 |
|---|---|---|
| Capture Only | 只记录 Interaction/Episode | 验证事实完整性 |
| Observe Only | 运行 Observer/Extractor | 验证 Schema/成本 |
| Candidate | 生成候选，不进入 Planner | 验证归纳质量 |
| Shadow | 生成对照 Plan，不影响正式任务 | Promotion 数据 |
| Advisory | 向用户/Planner 展示，必须确认 | 小范围试用 |
| Active Low-risk | 低风险 Active 自动注入，仍过 Validator | 后续租户灰度 |

# 12. 测试与验收体系

## 12.1 测试层级

- Unit：Domain、Hash、Fingerprint、RRF、Patch、Threshold、State Machine。
- Contract：JSON Schema、Repository Port、Model Stage、A2A Metadata、OpenAPI。
- Integration：PostgreSQL CAS/Lease/Outbox、BullMQ Worker、Memory Projection。
- E2E：模糊任务→澄清→Contract→Plan→确认→v1.2.2→Episode→Candidate→Promotion→下次任务。
- Replay/Shadow：Baseline/Champion/Candidate 和 non-regression。
- Chaos：Redis 清空、Worker 崩溃、DB 重启、Model 超时、重复 Event。
- Security：Prompt Injection、PII、作用域、Public Card、Path/Patch。
- A2A：TCK 与 input-required Continuation。

## 12.2 建议新增脚本

```text
pnpm db:reset:v1.2.3
pnpm test:cognitive:unit
pnpm test:cognitive:contract
pnpm test:cognitive:integration
pnpm test:cognitive:e2e
pnpm test:cognitive:replay
pnpm test:cognitive:chaos
pnpm verify:v1.2.3
```

最终合入现有 `pnpm verify`，继续复用 architecture、OpenAPI、acceptance、migration、sources、license、SBOM、A2A TCK 检查。

# 13. 可观测性与 SLO

| 域 | 指标 |
|---|---|
| Understanding | latency、clarification rounds、missing dimension recall、contract acceptance |
| Planning | candidate/revision、validator failure、confirmation、knowledge hit、fallback |
| Experience | episode lag/completeness、observer/extractor failure、dead letter |
| Knowledge | candidate/promote/reject、contradiction、shadow improved/regressed、usage |
| Capability | summary/card build、catalog hash change、gap candidate |


初始在线目标：Summary Cache P95≤50ms、Knowledge Retrieval P95≤500ms、Understanding P95≤3s、Plan Patch P95≤5s。

# 14. 工作量、人员与排期

## 14.1 人日

Goal 合计：**161～218 人日**（已采用推荐开源复用）。

不采用六仓库复用时预计增加 **22～34 人日**，即约 **183～252 人日**。

## 14.2 推荐团队

- Runtime/Domain Backend ×2。
- AI/Experience/Promotion Backend ×1。
- Console/API/QA Full-stack ×1。
- 架构/安全/评审 0.5 FTE 共享。

## 14.3 相对排期

| 周期 | 主工作 | 并行说明 |
|---|---|---|
| 第1～2周 | G00 | 冻结 Domain/ADR/Source Intake |
| 第3～4周 | G01、G07 | Capability 与 Experience Infrastructure 并行 |
| 第5～6周 | G02、G03、G08 | Card、Understanding、Observer 并行 |
| 第7～8周 | G04、G05、G06 | Goal/Plan/Correction 主链 |
| 第9～10周 | G09、G10、G11 | Reflector 与两类 Induction |
| 第11～12周 | G12、G13 | Promotion 与 Retrieval |
| 第13周 | G14 | Planner Injection/Fallback |
| 第14～15周 | G15、G16 | 产品集成与 Replay/Shadow |
| 第16～18周 | G17 | Hardening、灰度、Release |


这是 4 人交叉团队的建议计划；人员不足或 v1.2.2 接口冻结延迟时顺延。排期不包含外部审批等待。

# 15. 分支与 PR 策略

- 一个 Goal 可拆 1～3 个 PR，每个 PR 保持单一权威边界。
- 禁止在同一 PR 混合：Interactive Planning+Promotion、Card+Task Induction、Promotion+Skill Publish、Injection+High-risk Auto-confirm。
- 每个 PR 必须包含 Acceptance ID、Schema/DDL、测试、迁移、文档和证据。
- 对开源移植 PR 单独附 Source Intake、commit、许可证、修改说明和行为对照测试。
- Main 继续保护，所有变更通过分支和 Review。

# 16. Release Gate

- [ ] v1.2.2 Release Gate 已通过或作为 v1.2.3 基线明确冻结

- [ ] Domain/Schema/DDL 和 KD-01～KD-20 冻结

- [ ] Capability Summary 确定性和 Card 隐私审计通过

- [ ] Generic Understanding、Goal/Plan 多轮交互通过

- [ ] 未确认 Contract/Plan 不产生副作用

- [ ] Episode/Observer/Reflector 非阻断、幂等、可恢复

- [ ] Candidate/Active、Promotion/Replay/Shadow 通过

- [ ] Experience Fallback 和 Memory Projection 无双权威

- [ ] Tenant/User Scope、PII 删除和 Prompt Injection 通过

- [ ] 性能、容量、Backpressure、重启和 Redis 重建通过

- [ ] OpenAPI、Console、A2A TCK、Acceptance Map 通过

- [ ] Sources Lock、SBOM、THIRD_PARTY_NOTICES 和项目许可证通过

- [ ] Release Report 明确 Experience 仅为 Advisory，v1.2.3 不自动发布 Skill

# 17. Definition of Done

```text
系统能够：
1. 从 Enabled Skill 生成稳定 Capability Summary 和 Public Card；
2. 理解泛型任务并有界澄清关键缺失维度；
3. 形成用户确认的 Goal Contract；
4. 生成、展示、修改和确认 Skill Goal DAG；
5. 将用户修订记录为可学习的一等事实；
6. 从 v1.2.2 结构化事实异步生成 Episode；
7. 通过 Observer/Extractor/Reflector 形成候选知识；
8. 归纳 Task Type、Capability Pattern 和 Planning Heuristic；
9. 保存支持、反例、作用域、风险和版本；
10. 通过 Replay、Shadow、人工门禁晋升；
11. 使用 RRF 和 Progressive Disclosure 召回 Active Knowledge；
12. 经验不可用或无效时回退基础 Planner；
13. 所有知识使用能关联用户接受、Validator 和最终 Outcome；
14. 所有执行与完成权威仍由 v1.2.2、Provider 和 Outcome Judge 持有。
```

# 18. 最终实施定义

```text
SDAR v1.2.3 实施
=
v1.2.2 稳定执行事实
+
确定性能力认知
+
多轮人机 Goal/Plan 交互
+
Gemini-style 非阻断 Candidate Infrastructure
+
LangMem-style Typed Observation
+
ACE-style Reflector/Curator
+
AutoSkill-style Identity/Lineage/Promotion
+
AWM-style Task Type Induction
+
ReMe-style Hybrid Retrieval
+
SDAR-native Contract/Policy/Outcome/Recovery Authority
```
