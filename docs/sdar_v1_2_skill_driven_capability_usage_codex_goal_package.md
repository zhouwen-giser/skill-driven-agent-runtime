你正在 `zhouwen-giser/skill-driven-agent-runtime` 仓库中，以 Goal 模式完成 **SDAR v1.2：Skill 驱动的能力使用体系**。

最终目标不是新建第二套 Agent 或 Workflow 平台，而是在现有 SDAR Skill、Skill Graph、Workflow DSL、LangGraph Runtime、MCP Registry 和 v1.1 MCP Tasks 基础上，把 Skill 完善为：

> **LLM 能理解、能选择、能组合、能执行、必须遵守并且可追踪的能力使用说明书。**

完整目标链路：

```text
Goal
  → Skill Discovery
  → Applicability Assessment
  → Skill Selection
  → Execution Mode Selection
  → Skill Composition
  → Guidance / Template Interpretation / Procedure Compilation
  → Existing Workflow Planning and Execution
  → MCP Task / Provider / Resource
  → Skill Execution Record
```

必须交付：

1. 向后兼容的 Skill Package/Usage Specification；
2. `guidance`、`template`、`procedure` 三种模式；
3. 固定子 Skill 与动态能力槽位；
4. 可配置递归深度，默认 3、v1.2 硬上限 5；
5. `fail_fast`、`recoverable`、`optional`、`degraded` 失败传播；
6. Task Type 到 Provider 的动态、优选、强制和禁止绑定策略；
7. Skill 适用性、上下文需求、模式选择和计划合规检查；
8. `embodied.move_to` 和 `embodied.area_patrol` 两个正式示例；
9. Skill—Plan—Task—Provider—Resource—Evidence 的最小执行记录；
10. 完整单元、契约、集成、E2E、迁移和最终验收证据；
11. 每个小阶段独立提交并立即推送 GitHub；
12. v1.1 已完成代码提交；依赖其最终接口或运行语义的生产集成阶段，仍必须以最终 v1.1 提交已进入 `main` 为前置条件。

---

# 1. 当前仓库观察结果与重要提醒

用户已明确确认：

> **v1.1 已完成代码提交。**

因此，本任务不再等待 v1.1 继续编码，也不得要求 v1.1 团队补做普通实现后才推进 v1.2。Codex 开始工作时只需要确认“已提交的最终 v1.1 基线是否已经进入 `main`”。

执行时必须重新检查并记录：

- `feature/v1.1-mcp-tasks` 或其最终 PR 的最新提交 SHA；
- 该 SHA 是否已经被 `origin/main` 包含；
- 负责把最终 v1.1 提交合并到 `main` 的 PR 状态；
- 最新 `origin/main` 是否已经具备 v1.1 最终的 Remote Task、Availability、Timing、External Wait、Continuation、Input、Cancel、Reconcile 和验收实现；
- 最新 `origin/main` 的基线验证结果。

门禁语义调整为：

```text
v1.1 代码提交完成
  → 已满足，不再等待开发

v1.1 最终提交进入 main
  → 生产集成门禁
```

如果最终 v1.1 提交已进入 `main`：

- v1.1 Gate 在 Phase 0 即可判定为 `OPEN`；
- v1.2 分支必须从最新 `origin/main` 创建，或立即显式 merge 最新 `origin/main`；
- 不创建“等待 v1.1 开发完成”的 blocker；
- 可以连续执行 Phase 0～15。

如果最终 v1.1 提交尚未进入 `main`：

- 继续完成所有 `V11-INDEPENDENT` 工作；
- 可以只读检查已提交的 v1.1 分支/PR，用于契约映射、冲突分析和 Mock 对齐；
- 不得直接把 feature 分支代码作为 v1.2 的生产基线；
- 到达首个生产集成阶段时，只等待“最终 v1.1 提交合并到 `main`”，而不是等待 v1.1 继续开发；
- 合并完成后同步最新 `origin/main` 并继续。

除非用户另行明确授权，Codex 不得直接 merge、cherry-pick 或复制 `feature/v1.1-mcp-tasks` 到 v1.2；`origin/main` 始终是生产集成的唯一权威基线。

---

# 2. Goal 模式执行规则

## 2.1 自主执行

Codex 应自行完成：

- 仓库勘察；
- 实施规划；
- 代码修改；
- 测试；
- 阶段报告；
- Git 提交和推送；
- Draft PR 创建与更新；
- v1.1 最终提交与合并状态检查；
- v1.1 最终提交进入 `main` 后的基线同步；
- 最终验收和 PR Ready。

不要为普通实现细节逐项询问用户。只有本文列出的硬阻塞条件允许停止。

## 2.2 工作计划必须持久化

开始后创建并持续更新：

```text
execplans/EP-10-v1.2-skill-driven-capability-usage.md
reports/v1.2-skill-usage/sync-state.json
reports/v1.2-skill-usage/00-baseline.md
reports/v1.2-skill-usage/00-baseline.json
```

ExecPlan 至少包含：

- Goal；
- 当前基线 SHA；
- 权威输入；
- 阶段进度；
- v1.1 依赖分类；
- 发现事项；
- 设计决策；
- 测试证据；
- Blocker；
- 恢复入口；
- 最终结果。

每个阶段结束前更新进度，不允许只在本地记忆中维护计划。

## 2.3 每个阶段必须提交和推送

每个 Phase 必须：

1. `git fetch --tags origin`；
2. 检查工作区和远程分支；
3. 完成本阶段最小闭环；
4. 执行本阶段要求的测试；
5. 更新阶段报告；
6. 创建一个语义明确的独立 commit；
7. 立即 `git push`；
8. 记录 commit SHA、测试和推送结果。

禁止：

- 把多个阶段积压到一个大 commit；
- 已推送后 amend；
- rebase 已推送历史；
- force push；
- 用 reset 丢弃已有成果；
- 未运行测试却写“passed”。

## 2.4 Goal 模式不能无限后台等待

当执行到 v1.1 `main` 合并门禁且门禁仍关闭时：

- 不得 sleep、busy loop 或持续占用执行会话；
- 必须提交并推送阻塞报告；
- 将 ExecPlan 状态更新为 `BLOCKED_WAITING_FOR_V1_1_MAIN_MERGE`；
- 正常停止本次 Goal 执行；
- 后续重新启动 Goal 时，从远程分支和 ExecPlan 恢复；
- 恢复后首先重新检查 v1.1 最终提交是否已进入 `main`。

这就是本任务中“阻塞并等待”的标准实现，不得伪装成异步后台任务。

---

# 3. Git 分支与 PR 策略

## 3.1 创建分支

从执行时最新稳定 `origin/main` 创建：

```bash
git fetch --tags origin
git switch main
git pull --ff-only origin main
git switch -c feature/v1.2-skill-driven-capability-usage
git push -u origin feature/v1.2-skill-driven-capability-usage
```

如果分支已存在：

- 不得覆盖；
- checkout 现有远程分支；
- 阅读 ExecPlan 和 `sync-state.json`；
- 验证最后完成阶段；
- 从最后稳定阶段继续。

如果当前工作区存在用户未提交修改：

- 不得删除或覆盖；
- 优先使用独立 worktree；
- 无法安全隔离时创建 blocker。

## 3.2 Draft PR

Phase 0 提交并推送后，立即创建 Draft PR：

```text
head: feature/v1.2-skill-driven-capability-usage
base: main
title: feat(v1.2): implement skill-driven capability usage
```

Draft PR 作为长期集成面，PR Body 必须持续更新：

- 当前 Phase；
- 最新 commit；
- 已完成范围；
- v1.1 `codeSubmitted / mergedIntoMain / Gate` 状态；
- 测试状态；
- Blocker；
- 剩余工作。

最终验收全部通过后才能标记 Ready for Review。

未经用户明确授权，不得自动 merge v1.2 PR 到 `main`。

## 3.3 同步规则

已推送分支只允许使用显式 merge：

```bash
git fetch --tags origin
git merge --no-ff origin/main
```

禁止 rebase 和 force push。

v1.1 最终提交进入 `main` 后，必须 merge **最新 `origin/main`**；不得直接 merge、cherry-pick 或复制 `feature/v1.1-mcp-tasks`。在合并前，可以只读检查该分支用于契约和冲突分析。

---

# 4. 权威输入与阅读顺序

修改代码前必须阅读并建立摘要：

## 4.1 v1.2 权威设计

- `SDAR_v1.2_Skill_Driven_Capability_Usage_Overall_Design.md`
- 本任务包

Phase 0 应把它们放入仓库中稳定位置，例如：

```text
docs/24_V1_2_SKILL_DRIVEN_CAPABILITY_USAGE_DESIGN.md
docs/sdar_v1_2_skill_driven_capability_usage_codex_goal_package.md
```

路径可按实际文档编号调整，但不得丢失原始内容和冻结决策。

## 4.2 当前架构文档

至少阅读：

```text
README.md
PROJECT_STATUS.md
CHANGELOG.md
docs/02_ARCHITECTURE_BASELINE.md
docs/04_DOMAIN_MODEL.md
docs/05_WORKFLOW_DSL_SPEC.md
docs/06_API_AND_PROTOCOL_CONTRACTS.md
docs/09_TEST_AND_ACCEPTANCE_STRATEGY.md
docs/14_DECISION_LOG_ADR.md
docs/16_DEFINITION_OF_DONE.md
docs/17_TRACEABILITY_MATRIX.md
docs/18_KNOWN_ASSUMPTIONS_AND_GAPS.md
docs/20_CONFIGURATION_OPERATIONS_TROUBLESHOOTING.md
```

## 4.3 v1.1 权威文档

至少阅读：

```text
docs/22_V1_1_MCP_TASKS_DESIGN.md
docs/23_V1_1_MCP_TASKS_PROVIDER_EXTENSION.md
docs/SDAR_v1.1_MCP_Tasks_升级设计文档.md
docs/sdar_v1_1_mcp_tasks_codex_parallel_upgrade_package.md
execplans/EP-09-v1.1-mcp-tasks.md
reports/v1.1-mcp-tasks/sync-state.json
reports/v1.1-mcp-tasks/
```

## 4.4 当前 Skill 代码

至少检查：

```text
packages/domain/src/skill.ts
packages/domain/src/skill-graph.ts
packages/domain/src/skill-selection.ts
packages/domain/src/skill-input-resolution.ts
packages/domain/src/skill-call-workflow.ts
packages/domain/src/skill-quality.ts
packages/application/src/skill-registry.ts
packages/application/src/skill-selection.ts
packages/application/src/skill-semantic-retriever.ts
packages/application/src/skill-composition.ts
packages/application/src/skill-tool-policy.ts
packages/application/src/skill-call-workflow.ts
packages/application/src/workflow-planner.ts
packages/application/src/workflow-validator.ts
packages/application/src/workflow-controller.ts
packages/application/src/ports.ts
packages/langgraph-runtime/src/workflow-compiler.ts
packages/persistence-postgres/src/repositories.ts
apps/server/src/runtime.ts
```

## 4.5 仓库指令

检查并遵守所有：

```text
AGENTS.md
**/AGENTS.md
CONTRIBUTING.md
```

仓库实际指令优先于任务包中的普通实现建议，但不得改变已经冻结的产品目标和安全边界。

---

# 5. 已冻结的产品决策

以下决策不得在实现中擅自改写。

| ID | 决策 |
|---|---|
| D-01 | Skill 是能力使用说明书，不等同于 Capability Proof |
| D-02 | 首期面向具身控制，通用内核保持薄 |
| D-03 | 同时实现 `embodied.move_to` 和 `embodied.area_patrol` |
| D-04 | Skill 使用自然语言说明 + 结构化契约 |
| D-05 | 支持 `guidance`、`template`、`procedure` |
| D-06 | 默认引用 Task Type，允许 preferred/required/forbidden Provider |
| D-07 | 支持递归 Skill 组合 |
| D-08 | 默认递归深度 3，v1.2 运行硬上限 5 |
| D-09 | 同时支持固定依赖和动态能力槽位 |
| D-10 | procedure 编译为现有 Workflow DSL/DAG |
| D-11 | 支持 user-selectable/composable/internal-only 可见性 |
| D-12 | 失败传播为 fail_fast/recoverable/optional/degraded |
| D-13 | LLM 可以调整 adaptive，不能绕过 normative |
| D-14 | v1.2 只产生 SkillPatchCandidate，不自动发布 |
| D-15 | 无适用 Skill 时按风险等级 fallback/confirm/reject |
| D-16 | v1.2 只做最小事实记录和硬门槛，不做完整评价体系 |

---

# 6. 必须保持的现有架构

## 6.1 不建立第二套 Runtime

保持：

```text
Skill
  → Existing Planning / Workflow DSL
  → Existing LangGraph Compiler
  → Existing Workflow Runtime
  → MCP Tool / MCP Task
```

禁止：

- 新 Skill Runtime；
- 独立 procedure executor；
- 行为树 Runtime；
- Temporal/Restate 等第二执行引擎；
- LangGraph `interrupt/resume` 作为业务恢复；
- 让 Skill Package 直接控制设备；
- 绕过 Workflow Policy/Confirmation/Execution。

## 6.2 PostgreSQL 继续是权威存储

文件包是：

- 设计、分发和导入载体；
- Git 中可审查的参考实现。

正式运行时使用：

- 经 Schema 校验；
- 经人工/生命周期审批；
- 形成不可变版本快照；
- 已进入 PostgreSQL 的 Skill Version/Usage Specification。

运行时不得每次从任意文件路径动态加载未审查说明。

## 6.3 LLM 不成为规则权威

LLM 可以：

- 检索 Skill；
- 判断语义相关性；
- 解释适用性；
- 选择模式；
- 在允许槽位内选择子 Skill；
- 在 guidance/template 下生成计划；
- 提出 SkillPatchCandidate。

LLM 不可以：

- 修改 normative；
- 放宽硬门槛；
- 发明未注册 Task/Provider；
- 绕过 Tool Policy；
- 覆盖 `disabled`、权限拒绝或安全拒绝；
- 直接发布 Skill；
- 把自然语言输出当成持久化权威状态。

## 6.4 不复制 Provider 权威

Skill 只表达：

- Task Type 需求；
- Provider 偏好/强制/禁止；
- 质量或认证需求；
- 调度和替代建议。

Provider 继续负责：

- 实时可用性；
- 预约；
- 资源仲裁；
- 执行状态；
- 暂停恢复；
- 最终结果。

---

# 7. 与现有 Skill 模型的兼容策略

当前仓库已经具备：

- `SkillVersion`；
- Skill Registry；
- Semantic Retrieval；
- LLM Selection；
- Skill Graph；
- bounded composition；
- Tool Policy；
- Skill Input Resolution；
- Skill Workflow Guidance；
- Skill Quality/Evolution。

v1.2 必须扩展这些能力，不能平行复制。

## 7.1 SkillVersion 采用加法演进

不得直接废弃当前字段：

```text
capabilities
workflowGuidance
toolPolicy
runtimePolicy
inputSchema
outputSchema
```

建议新增一个不可变、可版本化的 Usage 结构，例如：

```ts
interface SkillUsageSpecification {
  readonly apiVersion: "sdar.io/v1alpha1";
  readonly visibility: SkillVisibility;
  readonly normative: SkillNormativePolicy;
  readonly adaptive: SkillAdaptiveGuidance;
  readonly modes: SkillModeSpecification;
  readonly taskBindings: readonly SkillTaskBinding[];
  readonly composition?: SkillCompositionSpecification;
  readonly evidencePolicy: SkillEvidencePolicy;
}
```

精确字段可根据现有模型调整，但必须：

- 向后兼容旧 Skill；
- 对新 Skill 形成不可变快照；
- 不把 untrusted JSON 直接传入 Runtime；
- 具备长度、数量、深度和枚举边界。

## 7.2 Legacy Skill 投影

旧 Skill Version 没有 v1.2 Usage Spec 时：

- 不得失效；
- 作为 `legacy_guidance` 兼容投影；
- `workflowGuidance` 作为 guidance；
- 现有 `toolPolicy` 继续作为确定性执行 allowlist；
- 不自动获得 procedure/template 能力；
- 不自动获得新的 Capability Slot；
- 运行记录标记 `usageSpecSource=legacy_projection`。

## 7.3 生命周期兼容

当前状态与设计状态存在差异。不得为了名称一致破坏现有 API 和数据库。

Codex 应通过 ADR 选择最小兼容实现，优先：

```text
现有存储/运行权威：draft / validating / enabled / disabled / deprecated / validation_failed

v1.2 视图：
draft      → draft
validating → candidate
enabled    → active
deprecated → deprecated
disabled   → retired-or-disabled projection
```

如确需区分 `approved` 与 `active`，采用附加字段或投影，不要大规模重命名已发布状态。

## 7.4 递归深度兼容

当前底层 Skill Graph 可能允许比 v1.2 更大的快照深度。v1.2 必须增加独立的 **运行时 Skill Usage Budget**：

```text
default = 3
hard maximum = 5
effective = min(system hard limit, skill limit, parent remaining budget)
```

不得仅依赖旧 Skill Graph 的更宽安全上限。

---

# 8. v1.1 依赖分类

用户已确认 v1.1 代码提交完成。以下分类的区别不再是“v1.1 是否还在开发”，而是“该工作是否必须以最终 v1.1 已进入 `main` 的生产基线为前置条件”。

每个子任务必须标记为以下一种。

## 8.1 V11-INDEPENDENT

可以立即开发，不依赖 v1.1 的生产集成基线：

- Skill Usage Domain types；
- immutable snapshot/validation；
- Skill Package Schema；
- 文件包校验和导入前模型；
- legacy projection；
- 示例 Skill 包；
- Applicability 纯规则；
- Mode Selection 纯规则；
- Composition IR；
- Capability Slot；
- Failure Policy；
- Guidance/Template/Procedure 中间表示；
- 单元和契约测试；
- Mock Task Readiness Port。

## 8.2 V11-CONTRACT-SENSITIVE

v1.1 已提交后可以立即开展契约分析、Port/IR、Mock 和兼容层设计，也可以只读检查最终 v1.1 分支/PR；但在最终提交进入 `main` 前，不得把这些内容接入生产路径：

- Task Type 到 Provider 的解析 Port；
- restricted/disabled/unknown 的 Skill 层映射；
- scheduled window 对模式/计划的影响；
- procedure 到 Workflow DSL 的编译接口；
- SkillExecutionRecord 中 RemoteTaskBinding 引用；
- Runtime graph node 接口；
- v1.1 最终符号映射和冲突预案。

约束：

- 允许基于已提交代码建立只读 symbol/contract map；
- 不允许复制 v1.1 实现；
- 不允许引用 feature branch 的 commit 作为发布依赖；
- 最终生产 Adapter 和 Runtime wiring 必须在 `origin/main` 基线上完成。

## 8.3 V11-MAIN-BASELINE-DEPENDENT

最终 v1.1 提交未进入 `main` 时绝对禁止开始生产编码：

- 引用 v1.1 最终 Remote Task continuation 类型；
- 修改 v1.1 最终 Workflow external-wait 状态；
- Provider Readiness 实际 Adapter；
- procedure 编译到含 `taskExecution` 的最终 DSL；
- `waiting_external` 下父子 Skill 联动；
- Remote Task 的 input_required/cancel/reconcile 集成；
- Runtime restart 恢复；
- v1.2 数据库 migration 编号最终分配；
- 修改 v1.1 最终 `ports.ts`、`workflow.ts`、`workflow-controller.ts`、`workflow-compiler.ts` 的集成代码；
- 真实 MCP Tasks E2E；
- 最终 v1.2 版本和 release acceptance。

---

# 9. v1.1 最终提交进入 main 的集成门禁

## 9.1 门禁以提交祖先关系为核心

用户已确认 v1.1 代码提交完成，因此 Codex 不再判断“Phase 4～6 是否还要继续开发”，也不再以 `package.json` 是否已经改为 `1.1.0` 作为必要条件。

Phase 0 必须识别并记录：

```text
V11_FINAL_SUBMITTED_SHA=<最终 v1.1 提交 SHA>
V11_INTEGRATION_PR=<将该提交合并到 main 的 PR，若存在>
```

v1.1 Gate 只有同时满足以下条件才为 `OPEN`：

1. 已识别用户所称“完成代码提交”的最终 v1.1 SHA；
2. 以下命令或等价检查证明该提交已经进入 `origin/main`：

   ```bash
   git merge-base --is-ancestor "$V11_FINAL_SUBMITTED_SHA" origin/main
   ```

3. 最新 `origin/main` 中存在 v1.2 所需的 v1.1 最终运行契约和实现，包括 Remote Task、Availability/Timing、External Wait/Continuation、Input、Cancel/Reconcile；
4. v1.1 合并没有遗留阻止 v1.2 集成的未解决冲突或 blocker；
5. 在最新 `origin/main` 上执行完整 `pnpm verify` 通过；
6. migrations、architecture 和既有 acceptance checks 通过。

以下内容可以作为补充证据，但不得单独替代提交祖先关系：

- PR 显示 merged；
- `PROJECT_STATUS.md` 更新；
- 最终验收报告；
- CHANGELOG 或版本号更新；
- Tag 或 Release 发布。

如果仓库通过 squash/rebase 导致原 SHA 不再是 `main` 的祖先，Codex 必须通过 PR merge SHA、tree/patch 等价性和必需文件/测试证明最终提交内容完整进入 `main`，并在 Gate 报告中记录判断依据。

## 9.2 门禁已开启时的行为

如果 Phase 0 即确认 Gate OPEN：

- 将 `sync-state.json` 写为 `V11_MAIN_BASELINE_READY`；
- 若 v1.2 分支尚未创建，从最新 `origin/main` 创建；
- 若分支已创建，立即显式 merge 最新 `origin/main`；
- 运行完整验证；
- Phase 0～15 连续推进；
- 不创建 v1.1 blocker commit。

## 9.3 门禁尚未开启时的行为

只有当所有 `V11-INDEPENDENT` Phase 已完成，并准备进入首个 `V11-MAIN-BASELINE-DEPENDENT` Phase 时，才创建：

```text
reports/v1.2-skill-usage/blockers/YYYYMMDD-waiting-for-v1.1-main-merge.md
```

内容至少包括：

- 当前 `origin/main` SHA；
- `V11_FINAL_SUBMITTED_SHA`；
- v1.1 集成 PR 及状态；
- 明确说明“v1.1 代码提交已完成，当前只等待 merge 到 main”；
- v1.2 已完成的独立 Phase；
- 下一个依赖 Phase；
- 恢复命令；
- 不允许提前实现的文件/接口。

同时更新：

```json
{
  "status": "BLOCKED_WAITING_FOR_V1_1_MAIN_MERGE",
  "lastCompletedPhase": "...",
  "mainSha": "...",
  "v11FinalSubmittedSha": "...",
  "v11Gate": {
    "codeSubmitted": true,
    "mergedIntoMain": false,
    "open": false,
    "missing": ["final_v1_1_submission_not_in_origin_main"]
  }
}
```

提交并推送：

```text
chore(v1.2): record v1.1 main merge blocker
```

然后停止本次 Goal。不得把阻塞描述成“等待 v1.1 开发完成”。

## 9.4 恢复时的行为

重新启动后：

```bash
git fetch --tags origin
git switch feature/v1.2-skill-driven-capability-usage
git pull --ff-only
```

读取：

```text
execplans/EP-10-v1.2-skill-driven-capability-usage.md
reports/v1.2-skill-usage/sync-state.json
reports/v1.2-skill-usage/blockers/
```

重新执行提交祖先关系和最新 `origin/main` 验证。

Gate OPEN 后：

```bash
git merge --no-ff origin/main
```

推送显式 merge，运行完整验证，更新 Gate 报告，然后进入依赖 Phase。

---

# 10. 阶段报告统一格式

每个阶段创建：

```text
reports/v1.2-skill-usage/NN-<phase-name>.md
reports/v1.2-skill-usage/NN-<phase-name>.json
```

必须记录：

- Phase；
- Goal；
- dependency class；
- base SHA；
- resulting SHA；
- changed files；
- architecture decisions；
- tests requested；
- tests actually run；
- pass/fail/skip；
- known limitations；
- deferred work；
- v1.1 submitted SHA / main merge Gate snapshot；
- Git push evidence。

报告中不得出现无法证明的测试数量或状态。

---

# 11. 分阶段执行计划

---

## Phase 0：仓库勘察、设计冻结和 Goal 基线

**依赖分类：** V11-INDEPENDENT
**建议 commit：**

```text
docs(v1.2): freeze skill usage goal-mode baseline
```

### 目标

建立可恢复、可审计的长期 Goal 执行面。

### 工作

1. 重新确认：
   - `main` SHA；
   - v1.1 branch/PR/Main 状态；
   - package version；
   - migration high-water mark；
   - ADR high-water mark；
   - 当前 test counts；
   - repository instructions；
   - dirty worktree；
   - push 权限。
2. 阅读权威文件。
3. 执行未修改基线：
   ```bash
   pnpm install --frozen-lockfile
   pnpm verify
   ```
4. 创建：
   - EP-10；
   - v1.2 总体设计仓库副本；
   - 本任务包仓库副本；
   - baseline report；
   - repository map；
   - symbol map；
   - v1.1 overlap map；
   - sync-state。
5. 把所有后续工作分成 INDEPENDENT / CONTRACT-SENSITIVE / DEPENDENT。
6. 创建并推送 v1.2 分支。
7. 创建 Draft PR。

### 约束

- 基线代码错误导致 `pnpm verify` 失败时，先创建 blocker，不得在未知红线基线上继续。
- 如果只是明确的外部基础设施不可用，可以记录实际非基础设施 Gate；但最终 Phase 不允许以此宣称完整通过。

### 验收

- Draft PR 存在；
- EP-10 可恢复；
- 基线证据完整；
- 没有生产代码改动；
- commit 已推送。

---

## Phase 1：Skill Usage Domain Contract

**依赖分类：** V11-INDEPENDENT
**建议 commit：**

```text
feat(v1.2): add immutable skill usage contracts
```

### 交付

新增或扩展稳定 Domain 模型：

```text
SkillUsageSpecification
SkillExecutionMode
SkillVisibility
SkillNormativePolicy
SkillAdaptiveGuidance
SkillObservedProfile
SkillContextRequirement
SkillTaskBinding
SkillProviderPolicy
SkillModeSpecification
SkillCompositionSpecification
SkillFixedDependency
SkillCapabilitySlot
SkillFailurePolicy
SkillEvidencePolicy
SkillPatchCandidate
```

### 必须满足

- immutable snapshot；
- finite JSON；
- bounded string/array/object depth；
- enum fail-closed；
- duplicate IDs rejected；
- Provider Policy 无矛盾；
- supported/default mode 一致；
- internal-only 与 user-selectable 不矛盾；
- Skill limit 不得超过 system hard limit 5；
- normative 与 adaptive 分离；
- no executable code；
- no private chain-of-thought 字段。

### 兼容

- 现有 `SkillVersion` 不失效；
- legacy projection 有单元测试；
- 当前 SkillStatus 不被破坏。

### 测试

- Domain unit；
- snapshot mutation adversarial tests；
- invalid enum/depth/size tests；
- legacy compatibility tests；
- typecheck；
- architecture check。

---

## Phase 2：Skill Package Schema、加载和安全校验

**依赖分类：** V11-INDEPENDENT
**建议 commit：**

```text
feat(v1.2): validate and load skill usage packages
```

### 交付

建议结构：

```text
skills/
  embodied-move-to/
    SKILL.md
    manifest.json
    normative.json
    adaptive.json
    composition.json
    evidence.json
    modes/
  embodied-area-patrol/
    ...
schemas/
  skill-package.schema.json
```

### 格式决策

结构化契约必须有 JSON Schema。

如果仓库没有直接、受控的 YAML Parser：

- 默认使用 JSON 作为 machine contract；
- `SKILL.md` 保留人类和 LLM 说明；
- 不得仅为了文件扩展名引入高风险依赖。

如决定使用 YAML：

- 必须新增 ADR；
- 使用直接固定依赖；
- 更新 lock、license、SBOM；
- 禁止自定义 tag、函数构造和任意对象实例化；
- 解析后仍必须通过 JSON Schema。

### 安全要求

- 防路径穿越；
- package root 约束；
- 文件大小上限；
- UTF-8；
- 禁止 symlink escape；
- 禁止可执行脚本自动运行；
- Markdown 仅作为受限文本；
- 不把文件系统内容直接当运行权威；
- 解析后深冻结。

### 交付服务

```text
SkillPackageReader
SkillPackageValidator
SkillPackageImporter
LegacySkillUsageProjector
```

此阶段可以使用 in-memory repository，不分配数据库 migration。

---

## Phase 3A：扩展现有 Skill Catalog 与版本接口

**依赖分类：** V11-INDEPENDENT
**建议 commit：**

```text
feat(v1.2): extend skill catalog with usage specifications
```

### 原则

扩展现有：

```text
SkillRegistryService
SkillRepository
SkillVersion snapshots
SkillCandidateSnapshot
```

不要新增平行 Skill Registry。

### 交付

- current/version 查询返回 Usage Spec 摘要；
- register/import 校验 Usage Spec；
- legacy/new package diff；
- lifecycle projection；
- visibility filter；
- mode filter；
- domain/tag filter；
- exact-version immutable read。

### 此阶段禁止

- PostgreSQL migration；
- Management API wiring；
- Console；
- Runtime graph wiring。

先用现有 in-memory test adapter 或测试 doubles 完成。

---

## Phase 3B：首期 Skill Package

**依赖分类：** V11-INDEPENDENT
**建议 commit：**

```text
feat(v1.2): add move-to and area-patrol skill packages
```

### `embodied.move_to`

必须包含：

- 目标与非目标；
- 位置、资源、权限上下文；
- guidance/template/procedure；
- Task Type；
- Provider Policy；
- 最低位置证据；
- Provider 声称成功但缺少位置证据时不能完成；
- 禁止区域；
- 取消/失败指导；
- visibility。

### `embodied.area_patrol`

必须包含：

- 区域边界；
- 资源状态；
- 时间窗口；
- 区域划分；
- 固定依赖；
- 动态能力槽位；
- `move_to` 子 Skill；
- 子区域失败策略；
- 覆盖、轨迹、异常报告证据；
- degraded 完成；
- 三种模式。

### 测试

- Package schema；
- package import；
- invalid package；
- legacy compatibility；
- golden snapshots。

---

## Phase 4：Applicability、Context Requirement 与 Mode Selection

**依赖分类：** V11-INDEPENDENT / CONTRACT-SENSITIVE
**建议 commit：**

```text
feat(v1.2): assess skill applicability and select execution modes
```

### 扩展现有选择链

保留现有：

```text
Semantic Retriever
SkillSelectionService
SkillSelectionDecider
SkillCandidateSnapshot
```

新增：

```text
SkillApplicabilityAssessor
SkillContextRequirementResolver
SkillModeSelector
SkillUsageCandidateSnapshot
```

### 适用性

至少支持：

```text
satisfied
partial
unsatisfied
unknown
```

上下文来源顺序：

```text
existing authoritative context
→ read-only query
→ deterministic derivation
→ user input
→ block/reject
```

不得猜测：

- 位置；
- 权限；
- 安全等级；
- 设备状态；
- 时间窗口；
- 禁止区域；
- 任务完成证据。

### Mode Selection

同一 Skill 可支持三种模式。

模式选择综合：

- 风险；
- normative；
- task readiness summary；
- context completeness；
- human confirmation；
- Skill support；
- system policy。

生产结果必须是结构化决策，LLM 不能返回任意模式字符串。

### v1.1 隔离

定义只读抽象 Port 和 Mock：

```ts
interface SkillTaskReadinessPort {
  inspect(...): Promise<SkillTaskReadinessSummary>;
}
```

此阶段不得接到真实 v1.1 Adapter。

---

## Phase 5：递归组合、Capability Slot 和三模式 IR

**依赖分类：** V11-INDEPENDENT / CONTRACT-SENSITIVE
**建议 commit：**

```text
feat(v1.2): resolve bounded recursive skill composition
```

### 扩展现有 Skill Graph

复用并扩展：

```text
SkillGraph
SkillCompositionPlanner
SkillCompositionContext
SkillRelation
```

不要创建第二张平行关系图。

### 组合能力

实现：

- fixed dependency；
- dynamic capability slot；
- exact-version candidate set；
- slot input/output compatibility；
- failure policy；
- parent-child parameter mapping；
- parent-child output mapping；
- recursion budget；
- cycle detection；
- duplicate expansion；
- max expanded skills/nodes；
- immutable composition plan。

### 深度

```text
default = 3
hard maximum = 5
```

父子调用必须消耗同一个预算。

### 三种 IR

```text
SkillGuidanceContext
SkillTemplateInstance
SkillProcedureProgram
```

procedure 此阶段只生成安全、确定、可校验的 IR；不得编译到最终 Workflow DSL。

### 失败策略

明确语义：

- `fail_fast`：父 Skill 失败；
- `recoverable`：尝试允许的替代/恢复；
- `optional`：记录失败但不阻断；
- `degraded`：父 Skill 可完成但标记降级和缺失效果。

### Phase 5 完成后的 Gate

完成 Phase 5、全量独立测试和 push 后，立即执行 v1.1 最终提交进入 `main` 的 Gate。

如果 Gate CLOSED，按第 9 节提交“仅等待 main merge”的 blocker 并停止。

---

## Phase 6：同步已提交并进入 main 的 v1.1 最终基线、冻结共享契约

**依赖分类：** V11-MAIN-BASELINE-DEPENDENT
**条件性 merge commit（仅当 v1.2 分支早于 v1.1 main merge 创建时）：**

```text
merge: sync v1.1 main baseline into v1.2
```

如果 v1.2 分支本来就从已经包含最终 v1.1 的 `origin/main` 创建，不得制造空 merge commit，直接进入报告提交。

**建议报告 commit：**

```text
docs(v1.2): record v1.1 main integration baseline
```

### 前置

v1.1 最终提交已进入 `main`，Gate OPEN。

### 工作

1. 检查当前 v1.2 HEAD 是否已经包含 Gate 报告记录的 `origin/main` 基线；
2. 若尚未包含，执行 `git merge --no-ff origin/main`，冲突处理时保留 v1.1 权威语义；
3. 若已经包含，不创建空 merge commit，仅记录基线 SHA；
4. 重新运行完整 `pnpm verify`；
5. 重新生成：
   - repository map；
   - symbol map；
   - overlap map；
   - migration high-water；
   - ADR high-water；
6. 将 Phase 4/5 的抽象 Port 对齐 v1.1 最终类型；
7. 分配 v1.2 ADR 和 migration 编号；
8. 发布正式 ADR：
   - Skill Usage Specification；
   - Three-mode execution；
   - Normative authority；
   - Recursive composition budget；
   - Skill package authority/import；
   - v1.1 readiness/continuation reuse；
   - execution record boundary。

### 冲突原则

- 不用 v1.2 旧实现覆盖 v1.1；
- Provider Authority 保持不变；
- external wait/continuation 保持 v1.1 唯一实现；
- Task availability enum 和 timing 直接复用；
- migration 只追加；
- 对共享类型做适配，不复制。

---

## Phase 7：持久化 Skill Usage Package 与 Catalog

**依赖分类：** V11-MAIN-BASELINE-DEPENDENT
**建议 commit：**

```text
feat(v1.2): persist versioned skill usage specifications
```

### 工作

基于真实 migration high-water 添加 append-only migration。

优先最小持久化：

- Skill Version 对应 Usage Spec；
- package source metadata；
- checksum；
- visibility；
- supported/default modes；
- normative/adaptive/evidence immutable snapshot；
- import audit；
- lifecycle projection。

可以：

- 在现有 Skill Version 表增加 JSONB 和索引；
- 或新增 normalized table。

必须通过 ADR 说明选择，不能平行复制整套 Skill Registry。

### API

扩展现有 Management API：

- validate package；
- import/register；
- get exact version；
- diff；
- list visibility/modes；
- lifecycle operation。

更新 OpenAPI、contract tests、Console 所需只读字段。

### 安全

- normative 更新必须创建新版本；
- active version 不可就地修改；
- checksum 验证；
- stale version fail-closed；
- unvalidated package 不可生产使用。

---

## Phase 8：Provider Readiness 与 Task Type 绑定集成

**依赖分类：** V11-MAIN-BASELINE-DEPENDENT
**建议 commit：**

```text
feat(v1.2): integrate skill task bindings with provider readiness
```

### 工作

建立：

```text
Skill Task Type
→ registered Tool/Operation candidates
→ provider policy filter
→ v1.1 readiness check
→ candidate summary
→ mode/planning decision
```

### Provider Policy

支持：

```text
dynamic
preferred
required
forbidden
required certifications/attributes
```

规则：

- `required` Provider 不可用时不能偷偷换；
- `preferred` 不可用时可按 Skill 指导替代；
- `forbidden` 永远过滤；
- `disabled` 硬阻断；
- `restricted` 携带时间窗口供改期；
- `unknown` 不得伪造 available；
- `guaranteed` 必须有有效 reservationRef；
- 节点执行前仍由 v1.1 再检查；
- Skill 层不保存资源权威状态。

### 测试

- available；
- restricted + earliest time；
- multiple windows；
- disabled；
- unknown；
- required provider unavailable；
- preferred fallback；
- forbidden provider；
- stale validUntil；
- reservation consistency。

---

## Phase 9：Guidance、Template、Procedure 与计划合规

**依赖分类：** V11-MAIN-BASELINE-DEPENDENT
**建议 commit：**

```text
feat(v1.2): compile skill usage modes into workflow plans
```

### guidance

将 bounded Skill Guidance 注入现有 Planner，包含：

- goal contract；
- normative constraints；
- adaptive guidance；
- allowed Task Types；
- related Skill exact versions；
- evidence requirements；
- mode decision；
- readiness summary。

不把整包、无界 Markdown 或历史记录全部塞入 Prompt。

### template

实现：

- 参数化骨架；
- allowed branches；
- optional slots；
- deterministic variable binding；
- no arbitrary templates/code；
- compile to existing Workflow DSL。

### procedure

实现：

```text
SkillProcedureProgram
→ validate
→ compile to existing Workflow DSL
→ existing Workflow Validator
→ existing confirmation/policy
→ existing LangGraph compiler
```

procedure 不直接执行。

### Plan Compliance

在 Planning 后强制检查：

- normative；
- Task Type allowlist；
- Provider Policy；
- recursion budget；
- failure policy；
- confirmation requirement；
- evidence plan；
- forbidden action；
- hard gate。

LLM 生成的计划不合规时：

- 可进行 bounded repair；
- 仍不合规则 request confirmation/reject；
- 不允许把“解释”当成合规。

---

## Phase 10：现有 Runtime/Graph 集成

**依赖分类：** V11-MAIN-BASELINE-DEPENDENT
**建议 commit：**

```text
feat(v1.2): integrate skill usage into the existing runtime
```

### 原则

根据仓库真实主链路适配，不得机械新增一套与当前架构并行的 AgentTurnGraph。

把功能接入当前：

```text
Goal/Task Service
Skill Selection
Skill Composition
Workflow Planner
Workflow Validator
Workflow Controller
LangGraph Compiler
Skill Call Workflow
```

### 需要形成的逻辑位置

```text
Goal contract
→ existing semantic Skill selection
→ applicability
→ mode selection
→ usage context
→ composition
→ planning/template/procedure
→ compliance
→ existing confirmation
→ existing execution
```

### Skill Execution Stack

维护：

- execution ID；
- exact Skill version；
- parent execution；
- recursion depth；
- mode；
- failure policy；
- plan/workflow refs；
- status。

不得使用进程内对象作为权威。需要持久化或嵌入现有不可变执行快照。

### v1.1 集成

- Remote Task external wait 不新增 Skill 状态机；
- 子 Skill 等待由现有 child workflow + v1.1 continuation 处理；
- parent Skill 不直接消费 child remoteTaskId；
- input_required 使用现有 durable input；
- cancel/reconcile 使用 v1.1；
- restart 后不重放已完成副作用；
- parallel/join 语义不改写。

---

## Phase 11：Skill Execution Record 与最小遥测

**依赖分类：** V11-MAIN-BASELINE-DEPENDENT
**建议 commit：**

```text
feat(v1.2): persist skill execution records and evidence links
```

### 必须关联

```text
Goal
Skill exact version
Parent/child Skill
Selection
Applicability
Mode
Context snapshot
Composition
Plan/Workflow
Task
Provider
Resource
RemoteTaskBinding
EvidenceRef
Hard Gate
Human Intervention
Outcome
```

### 最小状态

```text
selected
planning
executing
waiting_external
completed
failed
cancelled
degraded
```

状态必须与现有 Task/Workflow 权威一致，不能自行覆盖终态。

### 事件

至少：

```text
skill.discovered
skill.applicability_assessed
skill.selected
skill.mode_selected
skill.context_missing
skill.context_resolved
skill.composition_started
skill.child_selected
skill.plan_generated
skill.procedure_compiled
skill.plan_compliance_passed
skill.plan_compliance_failed
skill.execution_started
skill.execution_waiting_external
skill.execution_degraded
skill.execution_completed
skill.execution_failed
skill.hard_gate_triggered
skill.human_intervention
skill.patch_candidate_created
```

### EvidenceRef

复用现有 Evidence/Result 概念；若不存在，建立薄引用对象：

- ID；
- type；
- source system；
- URI；
- checksum；
- producedAt；
- producer refs。

不在 v1.2 建设 ClickHouse 评价平台。

### 查询

Management API 能查询：

- execution；
- parent/child tree；
- task/provider refs；
- evidence；
- hard gates；
- degraded reason。

---

## Phase 12：`embodied.move_to` 垂直验收

**依赖分类：** V11-MAIN-BASELINE-DEPENDENT
**建议 commit：**

```text
test(v1.2): verify the move-to skill vertical slice
```

### 场景

1. guidance + immediate Tool；
2. template + remote MCP Task；
3. procedure + deterministic DSL；
4. 缺少目标位置；
5. 禁止区域；
6. Provider available；
7. Provider restricted + 改期；
8. required Provider disabled；
9. remote input_required；
10. cancel；
11. Runtime restart and continuation；
12. Provider claims success but no final-position evidence；
13. final-position evidence valid；
14. legacy Skill still works。

### 成功条件

- 正确 Skill 和 mode；
- 计划合规；
- Task 调用正确；
- v1.1 waiting/continuation 正确；
- 没有证据时不得虚假完成；
- execution record 完整；
- no duplicate side effect。

---

## Phase 13：`embodied.area_patrol` 组合验收

**依赖分类：** V11-MAIN-BASELINE-DEPENDENT
**建议 commit：**

```text
test(v1.2): verify recursive area-patrol skill composition
```

### 场景

1. 单资源整区巡逻；
2. 多资源分区并行；
3. 固定 `move_to` 依赖；
4. 动态 capability slot；
5. 默认深度 3；
6. 尝试超过硬上限 5；
7. cycle；
8. 子 Skill fail_fast；
9. recoverable replacement；
10. optional failure；
11. degraded one-subarea failure；
12. Provider 时间窗口导致 reschedule；
13. 两个 remote child Task 独立结束；
14. parallel join 等待；
15. child input_required；
16. cancel parent；
17. restart during external wait；
18. coverage/evidence incomplete；
19. 完整父子执行树；
20. 不同上下文生成至少两类不同合法方案。

### 成功条件

- 父子 Skill exact version；
- 递归和规模 bounded；
- failure policy 精确；
- degraded 不被标记 full success；
- coverage/trajectory/anomaly evidence 可追踪；
- 其他并行分支不被远程等待阻塞；
- 已完成节点不重放。

---

## Phase 14：对抗性审查与修复

**依赖分类：** V11-MAIN-BASELINE-DEPENDENT
**建议 feature audit commit：**

```text
test(v1.2): add adversarial skill usage coverage
```

**建议 fix commit：**

```text
fix(v1.2): harden skill usage authority and recovery
```

### 必须主动寻找

- normative/adaptive 混淆；
- Prompt injection 修改安全规则；
- Markdown/JSON 过大；
- cyclic JSON；
- symlink/path traversal；
- stale Skill version；
- active Skill 就地修改；
- LLM 选择非候选 Skill；
- LLM 选择 unsupported mode；
- invented Task/Provider；
- preferred/required 语义漂移；
- recursive explosion；
- duplicate child execution；
- stale readiness；
- old reservation；
- parent/child terminal overwrite；
- remote Task duplicate event；
- restart replay；
- evidence spoofing；
- degraded 被投影为 full success；
- human gate bypass；
- legacy regression。

### 要求

审查发现的问题必须修复并加入回归测试，不能只写 Known Issues。

真正无法在 v1.2 解决的非阻断问题才可记录。

---

## Phase 15：最终验收、版本和发布证据

**依赖分类：** V11-MAIN-BASELINE-DEPENDENT
**建议 commit：**

```text
docs(v1.2): publish final skill usage acceptance evidence
```

### 工作

1. 更新：
   - package version；
   - CHANGELOG；
   - PROJECT_STATUS；
   - architecture/domain/DSL/API docs；
   - ADR index；
   - traceability；
   - known gaps；
   - operations；
   - release checklist。
2. 运行完整：
   ```bash
   pnpm format:check
   pnpm lint
   pnpm typecheck
   pnpm test:unit
   pnpm test:contract
   pnpm test:integration
   pnpm test:e2e
   pnpm build
   pnpm smoke
   pnpm verify:migrations
   pnpm verify:architecture
   pnpm verify:management-openapi
   pnpm verify:acceptance
   pnpm verify
   ```
3. 生成：
   ```text
   reports/v1.2-skill-usage/15-final-acceptance.md
   reports/v1.2-skill-usage/15-final-acceptance.json
   ```
4. 确认没有 required deferred item；
5. push；
6. 更新 Draft PR Body；
7. 标记 Ready for Review；
8. 不自动 merge。

---

# 12. 建议代码区域

最终路径以 Phase 0 仓库勘察为准。

```text
packages/domain/src/
  skill.ts                         # additive compatibility only
  skill-usage.ts                   # new
  skill-package.ts                 # new
  skill-execution.ts               # new
  skill-selection.ts               # extend snapshots/results
  skill-graph.ts                   # extend bounded usage composition

packages/application/src/
  skill-registry.ts                # extend, do not duplicate
  skill-selection.ts               # extend applicability/mode
  skill-composition.ts             # extend fixed/slot/failure
  skill-package-loader.ts          # new
  skill-applicability.ts           # new
  skill-mode-selection.ts          # new
  skill-interpretation.ts          # new
  skill-template-instantiator.ts   # new
  skill-procedure-compiler.ts      # new
  skill-plan-compliance.ts         # new
  skill-execution-recording.ts     # new
  ports.ts                         # after v1.1 Gate only

packages/persistence-postgres/src/
  repositories.ts
  skill-usage-repository.ts
  skill-execution-repository.ts

packages/langgraph-runtime/src/
  workflow-compiler.ts             # after Gate, minimal extension only

packages/management-api/
apps/console/
schemas/
  skill-package.schema.json
  management-api.openapi.yaml

skills/
  embodied-move-to/
  embodied-area-patrol/

infra/postgres/migrations/
  <actual-next>_skill_usage_specification.*
  <actual-next>_skill_execution_record.*

reports/v1.2-skill-usage/
execplans/EP-10-v1.2-skill-driven-capability-usage.md
```

---

# 13. 共享文件冲突规则

这些文件属于已提交 v1.1 的最终运行基线；最终提交进入 `main` 前禁止生产集成修改：

```text
packages/application/src/ports.ts
packages/application/src/workflow-controller.ts
packages/application/src/workflow-planner.ts
packages/application/src/workflow-validator.ts
packages/application/src/skill-call-workflow.ts
packages/domain/src/workflow.ts
packages/domain/src/remote-task.ts
packages/domain/src/mcp-task*.ts
packages/langgraph-runtime/src/workflow-compiler.ts
packages/persistence-postgres/src/repositories.ts
packages/runtime-redis/**
apps/server/src/runtime.ts
apps/console/**
schemas/workflow-dsl.schema.json
schemas/management-api.openapi.yaml
infra/postgres/migrations/**
```

Gate 前需要表达接口时：

- 新建 v1.2 本地 Port；
- 使用 test double；
- 不修改 v1.1 文件；
- Gate 后再做 Adapter。

冲突解决时：

1. 先保留 v1.1；
2. 理解其最终不变量；
3. 将 v1.2 作为加法重新应用；
4. 补回归测试；
5. 不选择“ours/theirs”粗暴覆盖。

---

# 14. 测试和验证节奏

## 每个 Phase

至少运行：

- changed-area unit/contract；
- `pnpm typecheck`；
- `pnpm lint`；
- architecture check（涉及依赖边界时）；
- format check。

## 强制完整 `pnpm verify`

至少在：

- Phase 0；
- Phase 2；
- Phase 5；
- v1.1 merge 后；
- Phase 10；
- Phase 14；
- Phase 15。

如果测试失败：

- 先判断本阶段回归或基线/环境问题；
- 不得提交“完成”报告；
- 可以提交明确的 blocker 或 WIP fix，但阶段不能标记完成。

---

# 15. Definition of Done

v1.2 只有全部满足才算完成。

## 15.1 架构

- 无第二 Runtime；
- 无 LangGraph interrupt/resume 业务恢复；
- PostgreSQL 仍是权威；
- v1.1 Provider/Remote Task Authority 未复制；
- 当前 Skill Registry/Selection/Graph 被扩展而非复制；
- legacy Skill 可继续运行。

## 15.2 Skill Package

- 自然语言 + 结构化契约；
- immutable exact version；
- normative/adaptive/observed 清晰；
- Package 安全校验；
- lifecycle 和 visibility；
- move_to/area_patrol 正式包。

## 15.3 使用

- Discovery；
- Applicability；
- Context Requirement；
- Mode Selection；
- guidance/template/procedure；
- fixed dependency；
- capability slot；
- default depth 3/hard 5；
- four failure policies；
- Task Type/Provider Policy；
- no-skill risk fallback；
- Plan Compliance。

## 15.4 v1.1 集成

- available/restricted/disabled/unknown；
- time windows；
- required/preferred Provider；
- remote wait；
- input_required；
- cancel；
- reconcile；
- restart；
- parent/child external wait；
- no duplicate side effect。

## 15.5 记录

- Skill Execution Record；
- parent-child tree；
- plan/task/provider/resource refs；
- EvidenceRef；
- hard gate；
- human intervention；
- degraded outcome；
- query API。

## 15.6 质量

- required tests pass；
- migrations clean and upgrade paths pass；
- architecture/OpenAPI/acceptance pass；
- full `pnpm verify` pass；
- final reports truthful；
- branch pushed；
- PR Ready；
- no unresolved required blocker。

---

# 16. 不允许实现的内容

v1.2 不得扩张为：

- Capability Ontology；
- Capability Graph 平台；
- Provider Factory；
- 自动 Provider 代码生成；
- ClickHouse 完整遥测平台；
- 完整 Skill 评价总分；
- Shadow/Canary；
- Skill 自动发布；
- 多组织 Registry；
- 通用资源调度器；
- 设备冲突仲裁；
- 独立低代码编辑平台；
- 新 Workflow Runtime；
- 任意递归/无界 Prompt；
- 自动修改 normative。

这些属于 v1.3/v1.4 或后续项目。

---

# 17. 硬阻塞条件

只有以下情况允许停止：

1. 未修改代码的基线存在真实失败且无法归因于已知外部环境；
2. GitHub 无写权限；
3. 分支保护阻止阶段 push；
4. v1.1 最终提交尚未进入 `main`，且所有 V11-INDEPENDENT Phase 已完成；
5. v1.1 最终实现与冻结 v1.2 目标存在不可通过兼容层解决的根本冲突；
6. 现有数据迁移不支持安全追加；
7. 当前架构无法保持单一 Workflow Runtime；
8. 安全或证据要求无法被确定性执行；
9. 依赖源或许可证不满足仓库要求。

停止时必须：

- 保留已完成成果；
- 写 blocker；
- commit；
- push；
- 更新 Draft PR；
- 给出准确恢复条件；
- 不宣称完成。

---

# 18. Goal 恢复协议

每次 Codex Goal 重启时：

1. 获取远程：
   ```bash
   git fetch --tags origin
   ```
2. checkout v1.2 branch；
3. 确保本地与远程一致；
4. 阅读 EP-10；
5. 阅读 sync-state；
6. 检查 PR；
7. 校验最后 Phase commit；
8. 运行必要 smoke/target tests；
9. 重新检查 v1.1 最终提交是否已进入 `main`；
10. 从第一个未完成 Phase 继续；
11. 不重复已完成 commit；
12. 不重写历史。

---

# 19. 每阶段提交清单

| Phase | Commit |
|---|---|
| 0 | `docs(v1.2): freeze skill usage goal-mode baseline` |
| 1 | `feat(v1.2): add immutable skill usage contracts` |
| 2 | `feat(v1.2): validate and load skill usage packages` |
| 3A | `feat(v1.2): extend skill catalog with usage specifications` |
| 3B | `feat(v1.2): add move-to and area-patrol skill packages` |
| 4 | `feat(v1.2): assess skill applicability and select execution modes` |
| 5 | `feat(v1.2): resolve bounded recursive skill composition` |
| Gate Block | `chore(v1.2): record v1.1 main merge blocker` |
| 6 Merge（条件性） | `merge: sync v1.1 main baseline into v1.2`；若分支已基于该 main 基线则不创建空 merge |
| 6 Report | `docs(v1.2): record v1.1 main integration baseline` |
| 7 | `feat(v1.2): persist versioned skill usage specifications` |
| 8 | `feat(v1.2): integrate skill task bindings with provider readiness` |
| 9 | `feat(v1.2): compile skill usage modes into workflow plans` |
| 10 | `feat(v1.2): integrate skill usage into the existing runtime` |
| 11 | `feat(v1.2): persist skill execution records and evidence links` |
| 12 | `test(v1.2): verify the move-to skill vertical slice` |
| 13 | `test(v1.2): verify recursive area-patrol skill composition` |
| 14A | `test(v1.2): add adversarial skill usage coverage` |
| 14B | `fix(v1.2): harden skill usage authority and recovery` |
| 15 | `docs(v1.2): publish final skill usage acceptance evidence` |

如果一个 Phase 确实过大，可以进一步拆分，但不得把多个表中 Phase 合并为一个大 commit。

---

# 20. Codex 最终输出格式

每次停止或完成时输出：

## Current state

- Branch；
- HEAD；
- PR；
- Last completed phase；
- v1.1 代码已提交状态与 main 合并 Gate；
- Test summary。

## Commits pushed

列出本次 Goal 新推送的 commit。

## Completed

说明真实完成内容。

## Blocked or remaining

如最终 v1.1 提交尚未进入 `main`，明确：

```text
BLOCKED_WAITING_FOR_V1_1_MAIN_MERGE
```

并明确缺失条件只是最终 v1.1 提交尚未进入 `main`，不得写成 v1.1 尚未开发完成。

## Resume

给出下一次 Goal 从哪里继续。

## Final completion

只有 Phase 15 全部满足时才输出：

```text
SDAR_V1_2_GOAL_COMPLETE
```

不得在部分完成、测试未通过、最终 v1.1 提交尚未进入 `main` 或 PR 未 Ready 时输出该标志。
