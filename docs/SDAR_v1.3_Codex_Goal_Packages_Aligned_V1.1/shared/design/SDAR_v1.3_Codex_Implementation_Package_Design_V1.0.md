# SDAR v1.3 Codex 实施拆包设计 V1.0

## Experience-Compiled Autonomous Runtime

> **状态：** Codex Goal Package Design Candidate  
> **目标仓库：** `zhouwen-giser/skill-driven-agent-runtime`  
> **设计基线：** `SDAR_v1.3_Design_Compendium_V1.0.md`  
> **代码基线要求：** 执行时最新 `origin/main`；G00 必须核验 v1.2.3 完成性  
> **实施方式：** Goal 模式、逐 Goal 提交、阶段级 Draft PR、禁止自动 Merge/Tag  
> **范围：** v1.3.0 Core + 可独立延后的 Case Runtime / Model Cascade 扩展  

---

# 1. 拆包结论

v1.3 不适合由一个超大 Goal 一次完成。任务必须按以下六条工程轨道拆分：

```text
Foundation        G00～G04
Offline Compiler  G05～G08
Validation        G09～G12
Online Runtime    G13～G18
Extended Runtime  G19～G20
Productization    G21～G22
```

核心首发只要求 Plan Template、Decision Rule、Fast Gateway、Replay、Shadow、人工批准和 Cognitive Fallback。Case Runtime 与自动 Model Cascade 是扩展 Goal，不阻断 v1.3.0 Core。

# 2. Codex 执行规则

1. 从最新 `origin/main` 创建 `feature/v1.3-experience-compiled-runtime` 或仓库规范要求的等价分支。
2. 首先读取 `AGENTS.md`、README、Architecture、当前 ExecPlan、package scripts、Migration、OpenAPI 和 Acceptance Map。
3. 创建 `execplans/EP-SDAR-V1.3.md` 并持续维护 Progress、Decisions in implementation（不新增独立产品决策章节）、Discoveries、Evidence、Blockers 和 Changed Files。
4. 每个 Goal 至少一个有意义提交；每个阶段更新 Draft PR 和 `reports/goal/sync-state.json`。
5. 每个 Goal 同时交付代码、测试、文档、迁移或 Schema、证据；TODO/Skeleton 不能冒充完成。
6. 遇到 v1.2.3 前置缺失时，继续不受影响的 Artifact Domain/Persistence/Skeleton，但不能宣称 Runtime Compiler 可工作。
7. 禁止引入第二套 Workflow Runtime、Memory Authority 或生产 Python Sidecar。
8. Artifact、Rule、Case、Shadow 均不得直接调用 MCP Tool 或写 User Goal Terminal。
9. 不自动 Merge，不创建 Release Tag。

# 3. 依赖图

```text
G00 → G01 → G02 → G03 → G04
             │
             └→ G05 → G06 → G07 → G08
                    │             │
                    └→ G09 ───────┤
                         → G10 → G11 → G12
                                      │
                           G13 → G14 → G15
                                      │
                           G16 ────────┤
                                      v
                                     G17 → G18
                                      │
                         ┌────────────┴───────────┐
                         v                        v
                        G19                      G20
                         └──────────┬─────────────┘
                                    v
                                   G21 → G22
```

实际可并行关系：G05 与 G09 Dataset Skeleton 可并行；G13 与 G16 Rule Runtime Skeleton 可并行；G21 的只读 UI/API 可在 G03 后提前建设，但写操作和最终状态必须等待 G12/G17。

# 4. Goal 级任务设计

## G00：仓库基线与 v1.2.3 完成性门禁

**阶段：** P0  
**发布范围：** v1.3.0 Core  
**依赖：** 无  
**估算：** 3～5 人日  
**建议 Owner：** 架构/Runtime Lead  
**代码落点：** `package.json`、`CHANGELOG.md`、`PROJECT_STATUS.md`、`execplans/`、`docs/`、`reports/`、`scripts/`  
**主要交付：** 基线报告、v1.2.3 依赖核验、符号地图、迁移序列、Master ExecPlan、Goal Sync State

### 实施任务

1. 从执行时最新 `origin/main` 开始，记录 HEAD、工作树、Node/pnpm/PostgreSQL/Redis 基线。
2. 验证 v1.2.3 必需对象是否真实存在：GoalExperienceEpisode、Observer、Reflector、Task Type、Capability Pattern、Promotion、Retriever、Experience Injection。
3. 验证 v1.2.3 Runtime Fact、Outbox、Outcome、PlanningInteraction 和 Memory Projection 是否可供 v1.3 读取。
4. 检查现有 Migration 最后一号、Architecture Gate、OpenAPI、Acceptance Map、A2A TCK、SBOM 和 Sources Lock。
5. 创建 `execplans/EP-SDAR-V1.3.md`、`reports/goal/sync-state.json` 和需求到 Goal 的追踪矩阵。
6. 若 v1.2.3 依赖缺失，输出阻断报告；继续所有只依赖 G00/G01 的设计与 Skeleton 工作，但不得伪造 Experience Compiler 可用。

### 验证

- 运行当前 `pnpm verify`。
- 执行必需符号、表和事件存在性检查。
- 校验最新 main 包含约定最低祖先。

### 完成合同

- 基线验证通过或形成精确阻断清单。
- 所有后续 Goal 的依赖和代码落点可解析。
- 未把 v1.2.3 未实现能力假定为已完成。

### 禁止事项

- 不得在本 Goal 编写产品功能。
- 不得修改或绕过 v1.2.3 权威。

### Codex 证据

- `reports/goal/g00-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G01：Runtime Artifact Domain、Schema 与架构门禁

**阶段：** P1  
**发布范围：** v1.3.0 Core  
**依赖：** G00  
**估算：** 8～12 人日  
**建议 Owner：** Domain/Architecture Engineer  
**代码落点：** `packages/domain/src/compiler/`、`schemas/v1.3/`、`scripts/check-architecture.mjs`、ADR  
**主要交付：** Artifact Domain、状态机、Condition DSL、Lineage、Validation、Execution/Feedback Schema、Golden Fixtures

### 实施任务

1. 定义 `CompiledArtifact`、Artifact Type、Status、Applicability、Dependency Snapshot 和 Runtime Binding。
2. 定义 Intent Route、Plan Template、Decision Rule、Case、Model Route 的结构化 Definition。
3. 定义 ConditionExpression、DecisionOutput、Parameter Binding、Failure Boundary 和 Risk Level。
4. 定义 Artifact Lineage、Validation Result、Approval、Execution、Feedback、Match Decision。
5. 冻结状态机：discovered→candidate→validating→awaiting_approval→active→revalidating→deprecated/archived/rejected。
6. 增加架构规则：Artifact Domain 不依赖 MCP SDK、Provider Adapter、Console 或 LangGraph 实现。
7. 增加规则：Artifact 不得直接调用 Skill/MCP，不得写 Outcome，不得修改 Skill/Policy。

### 验证

- Domain Factory/Invariant 单元测试。
- JSON Schema/Zod/AJV Contract Test。
- 状态迁移正反测试。
- Canonical Hash Property Test。
- Reverse Dependency Gate。

### 完成合同

- 所有 Artifact 类型有严格、版本化、可验证 Schema。
- 架构门禁能阻止直接 Tool/Skill 调用。
- Schema Golden Fixture 与 TypeScript Domain 一致。

### 禁止事项

- 不得用无约束 `unknown` 作为 Active Artifact 核心 Definition。
- 不得实现在线执行。

### Codex 证据

- `reports/goal/g01-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G02：Artifact PostgreSQL 持久化与 Repository

**阶段：** P1  
**发布范围：** v1.3.0 Core  
**依赖：** G01  
**估算：** 10～14 人日  
**建议 Owner：** Persistence Engineer  
**代码落点：** `infra/postgres/migrations/`、`packages/persistence-postgres/src/compiler/`、Repository Tests  
**主要交付：** M1 Migration、Repository、CAS、Active Pointer、Lineage、Validation/Approval/Execution/Feedback 表

### 实施任务

1. 按执行时迁移序列新增 `compiled_artifact`、`artifact_active_pointer`、`artifact_lineage`。
2. 新增 `artifact_validation_run`、`artifact_approval`、`artifact_execution`、`artifact_feedback`、`artifact_match_log`。
3. 新增 `experience_trace`、`pattern_candidate`，为 Plan Template/Decision Rule 提供专表或严格 JSONB 约束。
4. 实现 Candidate 保存、不可变版本、CAS 状态迁移、Active Pointer 原子切换和 Deprecated。
5. 实现 Validation、Approval、Execution 和 Feedback Repository。
6. 建立必要的唯一约束、索引、数据范围检查、JSON 大小/深度限制。
7. 提供 Redis 丢失后可从 PostgreSQL 重建的查询。

### 验证

- 空库迁移、rollback/reapply、重复迁移。
- Repository Round-trip。
- CAS/双激活 Race。
- Active Pointer 与 Artifact Version 一致性。
- 大 JSON/非法状态拒绝。

### 完成合同

- PostgreSQL 是唯一持久化权威。
- 同一 Artifact Key 同时最多一个 Active Version。
- 所有投影可从权威表重建。

### 禁止事项

- 不得将 Artifact Definition 放入 MemoryService 作为权威。
- 不得依赖 Redis 保证一致性。

### Codex 证据

- `reports/goal/g02-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G03：Artifact Registry、Active Index、Outbox 与 Feature Flags

**阶段：** P1  
**发布范围：** v1.3.0 Core  
**依赖：** G02  
**估算：** 8～11 人日  
**建议 Owner：** Application/Runtime Engineer  
**代码落点：** `packages/application/src/compiler/`、`packages/runtime-redis/`、`apps/server/src/runtime.ts`  
**主要交付：** ArtifactRegistryService、Active Index、Outbox、Cache Invalidation、Feature Flags、Management Read Ports

### 实施任务

1. 实现 ArtifactRegistryService：创建 Candidate、读取 Version、查询 Active Index、废弃和依赖失效。
2. 实现 Active Artifact Index 的 Level-0/Level-1 Progressive Projection。
3. 实现 Artifact 事务事件 Outbox 与 at-least-once Consumer。
4. 实现缓存键：Artifact Version、Active Pointer Version、Catalog Hash、Policy Hash、Tenant Scope。
5. 实现 `off|shadow|advisory|active` 注入模式和 Template/Rule/Case/Model Cascade 独立 Feature Flag。
6. 实现启动时 Registry/Cache 重建和一致性扫描。
7. 提供只读 Management Query Port，写操作暂不开放激活。

### 验证

- Active Index Cache Miss/Hit。
- Outbox 重复消费幂等。
- Cache 失效与重建。
- Feature Flag 完全关闭时 v1.2.3 行为不变。

### 完成合同

- Registry 可独立运行但不会影响正式任务。
- Feature Flag off 时不存在额外模型调用或计划写入。
- Active Index 与 PostgreSQL Pointer 一致。

### 禁止事项

- 不得在此 Goal 接入 User Request 入口。
- 不得自动激活 Candidate。

### Codex 证据

- `reports/goal/g03-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G04：操作员身份、审批与审计安全基线

**阶段：** P1  
**发布范围：** v1.3.0 Core  
**依赖：** G02、G03  
**估算：** 8～12 人日  
**建议 Owner：** Security/API Engineer  
**代码落点：** `packages/management-api/`、`apps/server/`、审计 Repository、OpenAPI  
**主要交付：** Operator Identity Port、Artifact Approval API Guard、审计、Idempotency/CAS、授权测试

### 实施任务

1. 为 Artifact validate/approve/activate/deprecate/revalidate 写操作建立操作员身份和权限 Port。
2. 在现有 trusted-intranet 模式上增加可替换的认证/授权边界，不将请求体 actorId 当作可信身份。
3. 所有写操作要求 reason、idempotencyKey、expectedVersion、actor 和审计记录。
4. 高风险 Artifact 激活要求显式权限与审批证据 Hash。
5. 建立 Approval 与 Activation 分离：批准不等于激活。
6. 为开发环境提供受控的 Local Operator Adapter；生产未配置身份提供者时写操作 fail closed。

### 验证

- 未认证/未授权写操作拒绝。
- actor 伪造无效。
- 重复 idempotencyKey 幂等。
- 过期 expectedVersion 冲突。
- 高风险审批权限。

### 完成合同

- 生产激活路径不存在匿名写操作。
- 审批、激活、废弃均可审计和重放。
- 读取 API 可按现有部署策略单独配置。

### 禁止事项

- 不得继续以 `trusted-intranet-only-no-auth` 作为 Artifact 激活的充分条件。
- 不得将人工审批编码为布尔字段而无证据。

### Codex 证据

- `reports/goal/g04-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G05：Experience Trace Normalization

**阶段：** P2  
**发布范围：** v1.3.0 Core  
**依赖：** G00、G01、v1.2.3 Episode 可用  
**估算：** 8～12 人日  
**建议 Owner：** Experience/Domain Engineer  
**代码落点：** `packages/application/src/compiler/experience-trace/`、`packages/persistence-postgres/`、Worker  
**主要交付：** ExperienceTraceBuilder、Normalization Policy、Trace Repository、Redaction、Cohort Fingerprint

### 实施任务

1. 将 GoalExperienceEpisode、PlanningInteraction、Skill Attempt、Workflow、Outcome、Recovery、Business Event 和 Artifact Feedback 转为统一 Trace。
2. 保留顺序、并行、分支、Authority Ref、用户修订、反例和环境类别。
3. 抽象设备实例、地点、临时时间、PII、Credential 和大 Tool Result。
4. 生成 Goal、Capability、Environment、Task Type Fingerprint。
5. 记录 Completeness、Data Classification、Normalizer Version 和 Source Hash。
6. 实现异步、幂等、可重放 Worker 与 Dead Letter。

### 验证

- 相同 Episode 生成相同 Trace Hash。
- 并行/分支顺序保持。
- PII/Credential Redaction。
- 不完整 Episode 不进入 Mining。
- Redis 丢失后重建。

### 完成合同

- Trace 足以支持流程发现且不泄露私有思维链。
- Source Episode 可追溯。
- Normalization 不阻断在线任务。

### 禁止事项

- 不得以自由文本摘要替代事件顺序。
- 不得删除失败和人工修订。

### Codex 证据

- `reports/goal/g05-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G06：Process Variant 与 Workflow Pattern Mining

**阶段：** P2  
**发布范围：** v1.3.0 Core  
**依赖：** G05  
**估算：** 12～18 人日  
**建议 Owner：** Mining/Algorithm Engineer  
**代码落点：** `packages/application/src/compiler/mining/`、离线 Benchmark、可选 `research/`  
**主要交付：** Variant Miner、Precedence/Concurrency Matrix、Mandatory/Optional/Recovery Pattern、质量指标

### 实施任务

1. 首版实现 TypeScript 确定性流程发现：Trace Variant、Direct-Follows、Precedence、Frequency、Mandatory/Optional。
2. 识别并行候选、循环、Recovery Branch 和异常变体。
3. 计算基础 Fitness、Precision、Variant Coverage 和 Environment Coverage。
4. 支持按 Tenant、Task Type、Goal Fingerprint、Capability Fingerprint 建立 Cohort。
5. 引入领域硬规则，过滤业务上不允许的模式。
6. 可建立 PM4Py 离线对照 Harness，但不得让 Python 成为生产权威。

### 验证

- 已知 Trace 集发现正确 Variant。
- 并行与顺序不混淆。
- 低频异常不被当成主流程。
- 领域禁止路径被剔除。
- TypeScript 与离线基线差异报告。

### 完成合同

- 输出结构化 DiscoveredProcessPattern。
- Mining 结果包含支持、反例和环境覆盖。
- 算法版本可重放。

### 禁止事项

- 首版不要求完整 Petri Net/BPMN 引擎。
- 不得直接生成 Active Template。

### Codex 证据

- `reports/goal/g06-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G07：Pattern Generalization 与 Artifact Candidate Generator

**阶段：** P2  
**发布范围：** v1.3.0 Core  
**依赖：** G06、G01  
**估算：** 10～15 人日  
**建议 Owner：** AI/Compiler Engineer  
**代码落点：** `packages/application/src/compiler/generalization/`、Model Stage、Candidate Repository  
**主要交付：** Pattern Fusion、Generalizer、Plan/Rule/Case/Route Candidate、Static Validator

### 实施任务

1. 融合 Process Mining 结构、v1.2.3 Task Type/Capability Pattern 和模型语义候选。
2. 抽象实例 ID 为变量、Domain/Device/Environment Class，保留 Invariant 和 Negative Condition。
3. 生成 Workflow→Plan Template、Condition→Rule、Exception→Case、Cost→Model Route Candidate。
4. 保存 Source Trace、Support/Contradiction、Generator/Model Version、Assumption、Unknown、Explanation。
5. 实现静态校验、Fingerprint 去重、Candidate Lineage 和低置信度隔离。
6. 模型只参与命名、变量抽象和 Negative Example，不决定上线。

### 验证

- 同类实例正确泛化。
- 不同完成标准不错误合并。
- 单一用户偏好不全局化。
- 非法/不完整 Candidate 拒绝。
- 模型无效输出 no-op。

### 完成合同

- Candidate 默认为不可运行。
- 所有字段可追溯到 Trace/Knowledge。
- 反例和 Unknown 不被省略。

### 禁止事项

- 不得由模型直接创建 Approval/Active 状态。
- 不得将一次成功固化为全局模式。

### Codex 证据

- `reports/goal/g07-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G08：Plan Template Compiler

**阶段：** P2  
**发布范围：** v1.3.0 Core  
**依赖：** G07、v1.2.3 Plan/Contract Validator  
**估算：** 12～18 人日  
**建议 Owner：** Goal Planning/Compiler Engineer  
**代码落点：** `packages/application/src/compiler/plan-template/`、Domain、Schema、Tests  
**主要交付：** Step Classifier、Capability Mapper、Skill Goal DAG Template、Parameter/Contract/Recovery Template

### 实施任务

1. 分类 Action、Observation、Reasoning、Verification、Recovery、Human Gate。
2. 将历史 Skill/Node 映射为 Capability Requirement，不绑定 Provider。
3. 生成 Skill Goal Node、Dependency、Criterion Coverage、Effect/Evidence/Artifact Requirement。
4. 生成参数 Schema、可信来源、默认策略和缺失字段处理。
5. 生成 Completion Contract Template 和有界 Recovery Branch。
6. 对 Candidate 执行 DAG、Bounds、Coverage、Side-effect Replay 和 Capability Shape 校验。
7. 保存 Compiler Version、Catalog Hash、Policy Snapshot 和 Content Hash。

### 验证

- DAG 无环/覆盖/边界。
- 不同设备 Skill 可实例化同一模板。
- 关键参数不得模型默认。
- Recovery 不重放副作用。
- Template Golden Fixture。

### 完成合同

- Template 能生成严格 UserGoalPlan Candidate。
- 模板不选择精确 Skill。
- 所有 Candidate 通过既有 Validator 才进入 Replay。

### 禁止事项

- 不得生成第二套 Workflow Runtime。
- 不得直接生成 MCP 调用。

### Codex 证据

- `reports/goal/g08-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G09：Replay Dataset 与 Fixture Builder

**阶段：** P3  
**发布范围：** v1.3.0 Core  
**依赖：** G05、G08  
**估算：** 10～14 人日  
**建议 Owner：** Evaluation/Data Engineer  
**代码落点：** `packages/application/src/compiler/replay/`、`tests/replay/`、Dataset Manifest  
**主要交付：** ReplayCase、Dataset Split、Counterexample Set、No-Physical Provider Harness

### 实施任务

1. 从 Episode/Trace 构建 request、contract、catalog、world、policy、accepted plan、outcome 快照。
2. 严格划分 discovery、candidate_development、promotion_holdout、counterexample 数据。
3. 实现数据版本、来源 Hash、Tenant 隔离和删除传播。
4. 实现 No-Physical Provider，禁止 Replay 调用真实 MCP 副作用。
5. 提供 Plan、Rule、Case 和 Counterfactual Replay Fixture。
6. 建立 Dataset Coverage 报告。

### 验证

- 数据集之间无 Source 泄漏。
- 删除 Episode 传播。
- Replay 不产生真实副作用。
- Snapshot Version 可重放。

### 完成合同

- 每个 Promotion Run 绑定不可变 Dataset Version。
- 发现集与晋升 Holdout 分离。
- Counterexample 可独立查询。

### 禁止事项

- 不得使用生产凭据。
- 不得把运行时最新状态替换历史快照。

### Codex 证据

- `reports/goal/g09-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G10：Replay 与流程一致性验证引擎

**阶段：** P3  
**发布范围：** v1.3.0 Core  
**依赖：** G08、G09  
**估算：** 10～15 人日  
**建议 Owner：** Evaluation/Runtime Engineer  
**代码落点：** `packages/application/src/compiler/validation/`、Validation Repository、Reports  
**主要交付：** Static/Plan/Rule/Counterfactual Replay、Fitness/Precision/Generalization、Validation Report

### 实施任务

1. 实现 Artifact Static Validation 和依赖快照检查。
2. 实现 Plan Replay：实例化→Plan Validator→Coverage/Cost/Plan Diff。
3. 实现 Rule Replay：与权威决策比较，计算 FP/FN/Unsafe Allow/Missed Confirmation。
4. 实现 Counterfactual Replay，不执行真实副作用。
5. 计算 Success、Coverage、Fitness、Precision、Generalization、Latency/Token 节省。
6. 输出不可变 Validation Result、Failure、Counterexample 和 Recommendation。

### 验证

- 相同 Dataset/Artifact 结果可重放。
- Holdout 不被训练逻辑修改。
- Unsafe Allow 强制 unsafe。
- 基础 Planner 不退化门禁。

### 完成合同

- Candidate 不通过 Replay 不可批准。
- 验证报告能解释失败案例。
- 所有指标定义和版本冻结。

### 禁止事项

- 不得只以成功率晋升。
- 不得让模型自评替代权威 Outcome。

### Codex 证据

- `reports/goal/g10-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G11：Shadow Engine

**阶段：** P3  
**发布范围：** v1.3.0 Core  
**依赖：** G03、G08、G10  
**估算：** 8～12 人日  
**建议 Owner：** Runtime/Evaluation Engineer  
**代码落点：** `packages/application/src/compiler/shadow/`、Runtime Hooks、Shadow Reports  
**主要交付：** Shadow Decision/Plan、Baseline Comparison、严格副作用隔离、Shadow Metrics

### 实施任务

1. 在正式 v1.2.3 路径旁路运行 Candidate Artifact。
2. Shadow 只生成 Decision/Plan，不创建正式 Attempt、Plan、通知或 MCP 调用。
3. 比较正式 Plan 与 Candidate 的 Coverage、Risk、Cost、Latency、User Patch 和 Outcome。
4. 实现过期 Candidate/Goal Version 丢弃。
5. 保存 Shadow Result 与正式 Outcome 的关联。
6. 建立 Shadow Capacity/Backpressure。

### 验证

- Shadow 无正式数据库副作用。
- Shadow 不发布通知/MCP。
- 过期版本丢弃。
- 正式路径失败不由 Shadow 覆盖。

### 完成合同

- Shadow 可安全在真实流量上运行。
- 结果可用于 Promotion。
- Feature Flag off 时零开销或有界最小开销。

### 禁止事项

- 不得让 Shadow 结果进入正式终态。
- 不得共享正式幂等键执行副作用。

### Codex 证据

- `reports/goal/g11-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G12：Artifact Approval、Promotion 与 Revalidation

**阶段：** P3  
**发布范围：** v1.3.0 Core  
**依赖：** G04、G10、G11  
**估算：** 10～14 人日  
**建议 Owner：** Governance/Runtime Engineer  
**代码落点：** `packages/application/src/compiler/promotion/`、Management API、Persistence、Outbox  
**主要交付：** Promotion Policy、Approval、Activation、Revalidation Trigger、Deprecation、Active Projection

### 实施任务

1. 聚合 Replay、Shadow、Counterexample、Risk Review 和依赖快照。
2. 实现 Candidate→Validating→Awaiting Approval→Active 的 CAS 状态机。
3. 批准与激活分离；激活事务校验审批 Hash、验证摘要和依赖有效性。
4. 实现运行失败、Catalog/Policy/Task Type/Schema 变化触发 Revalidating。
5. Revalidating Artifact 从 Fast Index 移除，但保留 Shadow。
6. 实现人工修订 Candidate 新版本和 Lineage。

### 验证

- 无审批不能激活。
- 审批针对旧 Validation Hash 时拒绝。
- 双激活 Race。
- 依赖变化自动 revalidating。
- 废弃后缓存失效。

### 完成合同

- 只有 Active Artifact 进入 Fast Gateway。
- 高风险永不自动激活。
- 所有状态迁移有审计与 Outbox。

### 禁止事项

- 不得由 LLM 或 Worker 自行批准。
- 不得自动发布 Skill。

### Codex 证据

- `reports/goal/g12-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G13：Artifact Index、Semantic Retrieval 与候选排序

**阶段：** P4  
**发布范围：** v1.3.0 Core  
**依赖：** G03、G12  
**估算：** 8～12 人日  
**建议 Owner：** Retrieval Engineer  
**代码落点：** `packages/application/src/compiler/retrieval/`、PostgreSQL/pgvector/FTS、Cache  
**主要交付：** Active Index、Exact/Structured/Semantic Retrieval、RRF/Ranking、Tenant/Version Filter

### 实施任务

1. 实现 Exact Pattern、Task Type、Domain、Tenant、Risk 和 Status 过滤。
2. 实现 Semantic Embedding 检索，复用现有 Embedding/Memory 基础设施但读取 Artifact 权威定义。
3. 实现 Level-0 Index→Level-1 Applicability→Level-2 Definition 渐进加载。
4. 实现候选排序、近分歧义和确定性 Tie-break。
5. 缓存绑定 Active Pointer、Catalog Hash、Policy Hash、Tenant。
6. 记录 Match Candidate 和检索解释。

### 验证

- 非 Active/跨租户不返回。
- Exact 优先、语义阈值和歧义回退。
- 缓存失效。
- 检索 P95。

### 完成合同

- 只返回当前有效 Active Artifact。
- Top Candidates 可解释。
- 语义匹配不能绕过硬条件。

### 禁止事项

- 不得把 Memory 搜索结果直接当 Active Artifact。
- 不得随机选取同分候选。

### Codex 证据

- `reports/goal/g13-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G14：Applicability、参数绑定与依赖有效性

**阶段：** P4  
**发布范围：** v1.3.0 Core  
**依赖：** G13、Capability Summary/Readiness/Policy Ports  
**估算：** 10～14 人日  
**建议 Owner：** Runtime Policy Engineer  
**代码落点：** `packages/application/src/compiler/applicability/`、Parameter Binding、Dependency Guard  
**主要交付：** ApplicabilityEvaluator、ParameterBinder、Capability/Readiness/Policy Guard、OOD

### 实施任务

1. 执行 Required/Optional/Forbidden Condition。
2. 按权威优先级绑定参数并保存 Source/Confidence。
3. 关键目标、范围、标准、安全授权不可由模型默认。
4. 校验 Capability Summary、Exact Skill Candidate 和 Provider Readiness。
5. 校验 Dependency Snapshot：Catalog、Policy、Task Type、Schema、Compiler Version。
6. 识别 Environment OOD 和 Uncertainty，输出 eligible/adapt/fallback/confirm/deny。

### 验证

- Forbidden Condition、缺参数、Capability Gap、Readiness Failure、Policy Deny。
- Catalog/Policy Hash 失配。
- 未知高风险字段回退。
- Parameter Source 优先级。

### 完成合同

- 硬条件失败时不能进入 Fast Path。
- 历史成功不替代 Readiness。
- 每个决定有 Reason Code。

### 禁止事项

- 不得用总评分覆盖硬拒绝条件。
- 不得静默填充授权。

### Codex 证据

- `reports/goal/g14-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G15：Plan Template Runtime 与 v1.2.x Handoff

**阶段：** P4  
**发布范围：** v1.3.0 Core  
**依赖：** G08、G12、G14  
**估算：** 12～17 人日  
**建议 Owner：** Goal Runtime Integration Engineer  
**代码落点：** `packages/application/src/compiler/runtime/`、v1.2.3 Planning Session、Plan Handoff  
**主要交付：** Template Instantiation、Plan Candidate、Validator Bridge、Review/Auto-confirm Policy、Execution Record

### 实施任务

1. 实例化 Active Template、Confirmed Contract 和可信参数。
2. 生成 v1.2.3 UserGoalPlan Candidate，并复用完整 Plan Validator。
3. 向 Interactive Planning 展示 Artifact 来源、版本、验证摘要和参数绑定。
4. 实现 shadow/advisory/active 三种 Handoff。
5. 在 Goal Version Lock 下幂等提交 Confirmed Candidate。
6. 记录 Artifact Execution selected/compiled/submitted/fallback。
7. 运行前 Readiness/Policy 再检查。

### 验证

- Template Candidate 与基础 Planner Contract 兼容。
- 未确认不执行。
- Goal Patch/Version Race。
- 执行前 Readiness 变化回退。
- Artifact completed 不提交 User Goal terminal。

### 完成合同

- Template 只缩短规划，不改变执行权威。
- Fallback 能无损进入 v1.2.3。
- 同一 Candidate 不重复提交。

### 禁止事项

- 不得直接调用 Skill/MCP。
- 不得跳过 Interactive/Auto-confirm Policy。

### Codex 证据

- `reports/goal/g15-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G16：Decision Rule Runtime 与 Safety Policy Bridge

**阶段：** P4  
**发布范围：** v1.3.0 Core  
**依赖：** G07、G10、G12、G14  
**估算：** 12～18 人日  
**建议 Owner：** Rule/Policy Engineer  
**代码落点：** `packages/application/src/compiler/rules/`、可选 ZEN Adapter、现有 Policy Port  
**主要交付：** Condition Evaluator、Decision Table、Conflict Resolver、Rule Trace、Safety Policy Bridge

### 实施任务

1. 实现首版确定性 Condition DSL 和 Decision Table Runtime。
2. 实现 risk/routing/confirmation/recovery/degradation/model_selection Decision。
3. 实现 Rule Priority、Conflict Group、more-specific/deny-overrides/human-required。
4. 业务 Rule 输出 Candidate Decision，再经过现有 Safety Policy。
5. 建立 Rule Replay 指标和在线 Decision Trace。
6. 评估 ZEN 依赖；若引入，锁定版本、许可证和行为 Contract；否则保留自研 Adapter Port。
7. OPA 仅作为可选 Policy Adapter，不成为计划引擎。

### 验证

- Condition Operator、Conflict Witness、Priority。
- Safety deny 覆盖业务 allow。
- Rule Timeout/Invalid Definition fail closed。
- Replay FP/FN。

### 完成合同

- Rule 运行无模型、无副作用、可解释。
- 安全 Policy 始终拥有最终 allow/deny/confirm 权威。
- 规则冲突不随机解决。

### 禁止事项

- 不得从经验自动激活安全 Policy。
- 不得让 Rule 直接执行动作。

### Codex 证据

- `reports/goal/g16-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G17：Fast Gateway 编排与 Cognitive Fallback

**阶段：** P4  
**发布范围：** v1.3.0 Core  
**依赖：** G13、G14、G15、G16  
**估算：** 12～18 人日  
**建议 Owner：** Runtime Lead  
**代码落点：** `packages/application/src/compiler/fast-gateway/`、`plan-preparation-processor`、A2A Task Entry  
**主要交付：** Request Normalizer、Gateway Orchestrator、Decision Log、Fallback Context、Feature Modes

### 实施任务

1. 在 User Request 入口前置 Fast Gateway，但保持 Feature Flag off 的原行为。
2. 实现 Request Normalization、Exact/Semantic Candidate、Applicability、Capability、Readiness、Rule/Policy 流程。
3. 输出 compiled_fast/template_adapt/small_model/cognitive/human/denied。
4. 实现歧义、低置信度和所有硬失败的 Cognitive Fallback。
5. 将 attempted Artifact、missing condition 和 observed fact 传给 v1.2.3，避免重复理解。
6. 记录 Match Log、Decision Snapshot 和 Runtime Correlation。
7. 达到 P95 目标且不牺牲检查。

### 验证

- off/shadow/advisory/active 全模式。
- 无候选/歧义/OOD/Policy deny。
- Fallback 保留上下文。
- Fast Gateway P95<200ms 基准。
- A2A 状态不增加私有枚举。

### 完成合同

- 不确定必回退。
- 低风险 Active Template 才可产生 Candidate。
- v1.2.3 基础链不回归。

### 禁止事项

- 不得以 Match Score 单独允许执行。
- 不得吞掉 Fallback 原因。

### Codex 证据

- `reports/goal/g17-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G18：Artifact Execution Feedback、监控与自动 Revalidation Signal

**阶段：** P4  
**发布范围：** v1.3.0 Core  
**依赖：** G12、G15、G16、G17  
**估算：** 8～12 人日  
**建议 Owner：** Telemetry/Runtime Engineer  
**代码落点：** `packages/application/src/compiler/feedback/`、Telemetry、Repositories、Workers  
**主要交付：** Execution/Feedback、Rolling Metrics、Revalidation Signal、Artifact Health

### 实施任务

1. 关联 Artifact Execution、Generated Plan、Task/Goal Outcome、用户 Patch、Policy Deny 和 Fallback。
2. 计算 rolling success、fallback、correction、latency/cost saving、OOD 和 safety failure。
3. 触发 Revalidation Signal，不直接改变 Active Artifact。
4. 实现 Artifact Health、Usage、Benefit 和 Failure Dashboard Projection。
5. 将反馈写回 v1.2.3 Experience Source。
6. 支持版本和 Tenant 维度统计。

### 验证

- Outcome 延迟关联。
- 重复反馈幂等。
- 阈值触发一次 Revalidation Signal。
- 安全失败立即隔离自动路径。

### 完成合同

- Artifact 可持续监控和退化。
- 执行反馈形成经验闭环。
- 统计不改变 Outcome Authority。

### 禁止事项

- 不得以单次普通失败自动删除制品。
- 不得由指标 Worker 直接重新激活。

### Codex 证据

- `reports/goal/g18-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G19：Case Runtime 与 CBR

**阶段：** P5  
**发布范围：** Extended，默认不阻断 Core  
**依赖：** G07、G09、G12、G14、G18  
**估算：** 12～18 人日  
**建议 Owner：** CBR/Recovery Engineer  
**代码落点：** `packages/application/src/compiler/case-runtime/`、Case Index、Recovery Integration  
**主要交付：** Problem Fingerprint、Hybrid Retrieval、Case Adaptation、Failure Boundary、Recovery Candidate

### 实施任务

1. 实现同 Tenant/Task Type 的 Structured+Semantic Case Retrieval。
2. 构建 Task/Environment/Failure/Capability/Constraint Fingerprint。
3. 实现 Similarity、Constraint、Outcome、Risk Ranking。
4. Case 只生成 Plan Patch/Recovery Plan/Parameter Candidate。
5. 复用 v1.2.2 Recovery Authority 和 Validator。
6. 保存 retrieved/adapted/accepted/rejected/success/failure/out_of_scope/unsafe。
7. 失败补充 Failure Boundary Candidate。

### 验证

- 文本相似但条件不符被拒绝。
- 跨租户拒绝。
- 高风险恢复需要人工。
- Case 不直接执行。

### 完成合同

- 特殊恢复可复用且不取代 Template/Planner。
- 所有 Case 有 Episode/Outcome Lineage。

### 禁止事项

- v1.3.0 Core Release 不以本 Goal 为阻断。
- 不得跨域自动迁移案例。

### Codex 证据

- `reports/goal/g19-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G20：Model Cascade 与成本路由

**阶段：** P5  
**发布范围：** Extended，默认不阻断 Core  
**依赖：** G17、G18、现有 Model Runtime  
**估算：** 10～15 人日  
**建议 Owner：** Model Runtime Engineer  
**代码落点：** `packages/application/src/compiler/model-cascade/`、Model Runtime、Budget Repository  
**主要交付：** Complexity Features、Budget、Route Decision、Fallback Chain、Cost/Quality Feedback

### 实施任务

1. 实现 none/local_small/cloud_medium/cloud_reasoning/human 路由 Port。
2. 路由权威顺序：Safety/Tenant Policy→Task Budget→Route Artifact→Cost Stats→Model Confidence。
3. 实现 Task/Goal/Tenant/Runtime 并发预算。
4. 首版先支持 Compiled→Strong Reasoning→Human；小模型 Provider 可选。
5. 记录每次升级原因，防止循环。
6. 离线生成 Route Candidate，仍需 Replay/Shadow/人工批准。

### 验证

- 预算耗尽、Provider 不可用、循环防护。
- 模型自信度不能越权。
- Route Feedback。

### 完成合同

- 模型成本可观测且有界。
- 大模型从默认变成兜底。

### 禁止事项

- v1.3.0 Core Release 不以自动路由优化为阻断。
- 不得让 Route Artifact 绕过 Policy。

### Codex 证据

- `reports/goal/g20-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G21：Management API、Console、A2A 与运维

**阶段：** P6  
**发布范围：** v1.3.0 Core  
**依赖：** G03、G04、G10～G18；扩展 UI 可等待 G19/G20  
**估算：** 12～18 人日  
**建议 Owner：** Full-stack/API Engineer  
**代码落点：** `packages/management-api/`、`apps/console/`、`packages/a2a-adapter/`、OpenAPI  
**主要交付：** Artifact/Compiler/Validation/Execution API、Governance Console、A2A Projection、Runbook

### 实施任务

1. 实现 Artifact list/detail/lineage/validation/approve/activate/deprecate/revalidate。
2. 实现 Compiler Trace/Pattern/Run/Candidate API。
3. 实现 Execution/Match/Feedback 查询。
4. Console 展示 Lineage、Definition Diff、Replay、Shadow、Counterexample、Approval、Health。
5. Interactive Planning 显示 Template 来源和验证摘要。
6. A2A 公开 Card 不暴露 Artifact；可信内部仅展示 compiledPath 可用性摘要。
7. 实现 Dead Letter、Replay Trigger、Cache Rebuild 和运维 Runbook。

### 验证

- OpenAPI Contract。
- 认证/授权/CAS/幂等。
- Console Diff/状态。
- Public/Internal 隔离。
- A2A TCK。

### 完成合同

- 操作员可安全管理 Artifact 生命周期。
- 公开协议不泄露内部规则/案例。
- 运维操作可审计。

### 禁止事项

- Console 不得直接修改 Active Definition。
- 不得从 UI 直接执行物理动作。

### Codex 证据

- `reports/goal/g21-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

## G22：Hardening、性能、安全、灰度与发布

**阶段：** P7  
**发布范围：** v1.3.0 Core  
**依赖：** G00～G18、G21；Full Release 另含 G19/G20  
**估算：** 15～22 人日  
**建议 Owner：** 全团队/Release Lead  
**代码落点：** 全仓库、CI、scripts、infra、reports、SBOM、THIRD_PARTY_NOTICES  
**主要交付：** Full Verify、Chaos/Performance/Security、Release Report、SBOM、Sources Lock、Draft PR

### 实施任务

1. 完成 Unit/Contract/Integration/E2E/Replay/Shadow/A2A TCK。
2. 完成 Redis 清空、Worker Crash、PostgreSQL Restart、Cache Stale、Duplicate Event、CAS Race。
3. 完成 Prompt Injection、PII、Tenant Isolation、匿名激活、Path/Schema/JSON 攻击测试。
4. 验证 Fast Gateway、Template Plan、Rule Runtime 性能目标。
5. 按 off→shadow→advisory→active low-risk 灰度。
6. 更新 Architecture、Storage、OpenAPI、Traceability、Acceptance、Runbook、SBOM、Sources Lock。
7. 生成 Core 与 Full Scope 两类 Release Report。
8. 不自动 Merge，不创建 Tag。

### 验证

- `pnpm verify` 全绿。
- 独立数据库完整门禁。
- 性能与容量报告。
- 安全与许可证报告。
- 真实 v1.2.3 Fallback E2E。

### 完成合同

- v1.3.0 Core 所有门禁通过。
- 高风险自动执行为零。
- Fast Path 失败 100% 可回退或明确失败。
- 工作树干净，Draft PR 可审查。

### 禁止事项

- 不得用 Mock 作为最终线上集成证据。
- 不得隐藏失败尝试或降低门禁。

### Codex 证据

- `reports/goal/g22-completion.md`
- 精确 Commit SHA、Changed Files、命令、测试计数、失败尝试、Acceptance 映射。
- 更新 Master ExecPlan、Sync State、Draft PR 描述。

---

# 5. 阶段级 PR 边界

| 阶段 PR | Goals | 主要内容 | 合并前门禁 |
|---|---|---|---|
| PR-A Foundation | G00～G04 | Domain、Persistence、Registry、审批安全 | Full verify；无产品 Fast Path |
| PR-B Offline Compiler | G05～G08 | Trace、Mining、Generalization、Template Compiler | Replay Fixture；Candidate only |
| PR-C Validation | G09～G12 | Replay、Shadow、Promotion | 无 Candidate 可绕过审批激活 |
| PR-D Online Core | G13～G18 | Retrieval、Applicability、Template/Rule、Gateway、Feedback | off/shadow/advisory/active E2E |
| PR-E Extended | G19～G20 | Case、Model Cascade | 默认关闭；独立验收 |
| PR-F Productization | G21～G22 | API/Console/A2A、Hardening、Release | `pnpm verify`、A2A TCK、Security、Performance |

这些可以采用顺序合并的阶段 PR，也可以在一个长期集成分支上保持多个 Draft PR；不得把所有变更压成单一不可审查 PR。

# 6. 数据库迁移批次

| Migration Batch | Goals | 表组 |
|---|---|---|
| M1 Artifact Authority | G01～G03 | artifact、active pointer、lineage、outbox/cache projection |
| M2 Governance | G04、G10～G12 | validation、approval、status transition、counterexample |
| M3 Compilation | G05～G09 | experience trace、pattern candidate、dataset manifest |
| M4 Runtime | G13～G18 | match、execution、feedback、health/revalidation |
| M5 Extended | G19～G20 | case index/adaptation、model route/budget |

迁移编号必须在 G00 根据执行时 main 的最后 Migration 分配；不得在设计阶段硬编码固定编号。

# 7. 工作量评估

## 7.1 纯 v1.3 增量

| 口径 | 人日 | 说明 |
|---|---:|---|
| v1.3.0 Core | **206～303** | 不含 G19 Case 与 G20 Model Cascade |
| Extended | **22～33** | Case Runtime + Model Cascade |
| v1.3 Full | **228～336** | G00～G22 全部完成 |
| Core + 20% 风险储备 | **247～364** | 新型 Mining、Rule、Shadow、集成不确定性 |
| Full + 20% 风险储备 | **274～403** | 完整版本预算 |

估算已包含：Domain、Migration、Repository、Application、测试、文档、证据、OpenAPI、Console 和阶段性集成；不包含外部审批等待、仿真平台建设和领域数据标注。

## 7.2 当前仓库前置差距口径

当前可见 `main` 的 v1.2.3 合并证据仅覆盖 G00～G06。若 Experience Episode、Observer/Reflector、Task Type/Capability Pattern、Promotion、Retriever 和 Experience Injection 确实尚未在其他提交中完成，则必须先补齐 v1.2.3 G07～G17。按此前详细计划，该部分约 **110～148 人日**。

| 当前状态假设 | Core 总量 | Full 总量 |
|---|---:|---:|
| v1.2.3 已完整完成 | 206～303 | 228～336 |
| 当前 main 仍缺 v1.2.3 G07～G17 | 316～451 | 338～484 |

G00 必须用代码、表、事件和测试确认实际情况，不能仅根据版本名称判断。

## 7.3 人员与日历周期

| 团队 | v1.3.0 Core | v1.3 Full | 说明 |
|---|---|---|---|
| 3 名工程师 | 30～40 周 | 34～46 周 | 顺序依赖明显，不推荐 |
| 5 名交叉团队 | **18～24 周** | **21～28 周** | 推荐配置 |
| 7 名交叉团队 | 15～20 周 | 18～24 周 | 再增加人员的边际收益有限 |

推荐团队：Runtime/Domain 2、Mining/AI 1、Persistence/Policy 1、Full-stack/QA/Operations 1，并共享 0.5 FTE 架构与安全评审。若还需补齐 v1.2.3 G07～G17，5 人团队建议额外预留 8～12 周。

## 7.4 工期主要来源

| 高成本区域 | 原因 |
|---|---|
| Process/Workflow Mining | 需要可解释的确定性结构，不是一次 LLM 总结 |
| Replay/Shadow | 必须重建快照、隔离副作用并与正式 Outcome 对齐 |
| Template Runtime/Handoff | 需保持 Goal/Plan/Skill/Outcome 全部原权威 |
| Rule/Policy | 冲突、FP/FN、安全覆盖和版本治理复杂 |
| Fast Gateway | 低延迟同时不能省略 Applicability、Readiness 和 Policy |
| Approval Security | 当前管理端若无认证，生产激活必须新增可信身份边界 |

# 8. Codex 模型与执行强度建议

```text
G00～G04、G10～G12、G14～G18、G22
→ 强推理档，单主 Agent

G05～G09、G13、G19～G21
→ High；边界清晰后可降档

多 Agent/Ultra
→ 仅用于只读并行审查、测试覆盖、许可证和最终发布审计
```

核心 Domain、Migration、Active Pointer、Promotion 和 Fast Gateway 不允许多个子 Agent 同时修改重叠文件。

# 9. Master Goal 完成定义

v1.3.0 Core 只有同时满足以下条件才完成：

```text
Artifact Domain/Persistence/Registry 完整
Experience Trace 与 Workflow Pattern 可生成 Template Candidate
Replay 和 Shadow 可证明 Candidate 的收益和风险
生产激活需要可信操作员审批
Active Template 可生成 v1.2.3 Plan Candidate
Plan 继续经过完整 Validator、确认策略和 v1.2.2 Execution
Decision Rule 无模型、无副作用，且安全 Policy 最终裁决
Fast Gateway 不确定时 100% 回退 Cognitive Runtime
Artifact Feedback 能触发 Revalidation 而不越权修改制品
Feature Flag off 时 v1.2.3 行为不回归
真实 PostgreSQL/Redis、A2A、MCP、Outcome 集成通过
高风险 Artifact 自动执行为 0
```

# 10. 后续产物

本设计冻结后，可以继续生成完整 Codex Goal 任务包，包含 `MASTER-GOAL.md`、`EXECUTION-POLICY.md`、G00～G22 独立文件、Acceptance Matrix、ExecPlan Template、Evidence Template、manifest.json 和自检脚本。
