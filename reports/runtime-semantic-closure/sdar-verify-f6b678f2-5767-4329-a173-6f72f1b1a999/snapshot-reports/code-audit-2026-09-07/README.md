**当前工作树功能实质性审计 — 2026-09-07**

审计对象：`473ad7d82cb11eda530aaa46d77478850bd1e51e` 加当前未提交改动。只增加本目录审计材料，没有修复或修改产品代码。原始 SRS、需求基线、架构与领域基线、相关 ADR、DoD、追踪矩阵和生产装配代码共同作为依据。原始 SRS 的 A2A 1.0.0 与现行 1.0.1 差异已有 ADR-069，不作为未记录的基线偏移。

结论：核心模块已有大量真实实现，但目前不足以宣称“通用 A2A + Skill 驱动 + 任意合法 DSL + 完整 Workflow 执行”全面成立。主要问题集中在默认入口装配、Task Type 在线闭环、组合图语义、异步状态衔接和 Skill 演化门禁。已有测试通过不能排除本次最小反例。

| 用户关心的能力 | 判断 | 实质情况 |
| --- | --- | --- |
| A2A 是否泛化 | 协议层基本成立，业务层不充分 | 官方 SDK、标准状态、HTTP+JSON、查询和后续输入已落地；stream 完成结果缺失；特定 profile 与专用 admission 限制业务扩展 |
| A2A 任务类型是否形成 | 模型形成，在线闭环未形成 | 语义 Task Type 有领域模型、归纳、版本、晋升和 PG 存储；初始识别仍读取静态配置 |
| Skills 是否符合要求 | 主体实现，部分关键要求未落实 | 注册、版本、包、图谱、Usage、skill_call 已实现；默认选择、Schema 明确性、失败策略、演化验证及策略继承有缺口 |
| 动态 DSL 是否正确 | 基本校验与编译实现，组合语义不完备 | 受限 AST、10 类节点、自动修正、不可变图已实现；条件×并行、循环上限及退出边存在反例 |
| Workflow 执行是否完整 | 普通链路较完整，跨状态组合不完整 | 初始确认、简单并行、远程等待及 skill_call 有实现；等待后确认、普通 subworkflow、失败策略与取消传播存在断点 |

**证据等级**

- 已复现：运行真实应用/编译器类，使用本地模拟模型、工具、仓储或 notifier；不等于真实供应商模型或设备验收。
- 静态确认：生产装配和调用链明确，但本次没有真实 PostgreSQL/Redis/Provider 端到端重现。
- 待验证：发现可疑链路，尚不足以断言完整场景失败。
- P1 表示可影响核心正确性、约束或结果；P2 表示能力覆盖、鲁棒性或证据缺口。这里不是重新定义基线需求的 P0 优先级。

**已确认发现，按修复价值排列**

1. **P1：并行内部存在条件分支，汇合节点未执行却返回成功。已复现。**

   最小图：`parallel → [condition → a1/a2, b] → result`。Validator 返回 `valid=true`，运行只完成 p、b、condition、a1；result 从未运行，返回 `status=succeeded` 且无结果。

   [workflow-compiler.ts:749](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/langgraph-runtime/src/workflow-compiler.ts:749) 将互斥 a1/a2 全部收集为汇合节点必到前驱，405 行构造 AND barrier；[435 行](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/langgraph-runtime/src/workflow-compiler.ts:435) 在没有 failed/wait/interrupt 时直接判成功，不验证必要出口和汇合完成。影响 FR-WF-002/003 与结果完整性。应按实际激活分支维护汇合义务，并增加终态完整性检查。

2. **P1：远程等待结束后进入人工确认，无法继续恢复。已复现。**

   `mcp_tool(waiting_external) → human_confirmation → result`；远程完成 continuation 返回 paused，随后 `resumeHumanConfirmation` 抛 `WORKFLOW_CHECKPOINT_NOT_AVAILABLE`。

   [workflow-executor-adapter.ts:78](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/langgraph-runtime/src/workflow-executor-adapter.ts:78) 没有保留 continuation compiled 实例；[workflow-compiler.ts:614](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/langgraph-runtime/src/workflow-compiler.ts:614) 新建执行图，623 行使用另一 thread ID，643 行无条件删除 runtime context。只补 Map 不足以修复；需统一后续确认恢复所需的实例、图、thread 和 context。影响等待×确认及后续 pause/cancel 控制。

3. **P1：`fail_fast` 在执行阶段可被模型的 continue 覆盖。已复现。**

   `skill_call` 抛 `CHILD_FAILED`，handler 声明 `strategy:terminate`、`skillFailurePolicy:fail_fast`，但模型选 continue 后仍完成 result，整体 succeeded。

   [workflow-compiler.ts:1213](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/langgraph-runtime/src/workflow-compiler.ts:1213) 构造 allowedStrategies 时未考虑上述强约束，仍允许 terminate/continue。[skill-usage-planning.ts:522](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/application/src/skill-usage-planning.ts:522) 只检查计划声明。应在运行时由确定性策略缩小模型选择范围，而不是仅在规划时检查字段。

4. **P1：默认通用路径没有装配正式 Skill 选择服务。静态确认。**

   `SDAR_TASK_UNDERSTANDING_PROFILE` 默认 off；main 没有注入 options.skillSelection。[runtime.ts:2567](/home/zhouwen/web-download/skill-driven-agent-runtime/apps/server/src/runtime.ts:2567) 至 2619 的构造分支仅在显式配置或特定 profile 时启用选择服务。[runtime.ts:5333](/home/zhouwen/web-download/skill-driven-agent-runtime/apps/server/src/runtime.ts:5333) 在服务缺失时返回全部 enabled Skills；[skill-goal-scheduler.ts:121](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/application/src/skill-goal-scheduler.ts:121) 取第一个兼容者。替换 Skill 路径还会抛 `SKILL_SELECTION_RUNTIME_NOT_CONFIGURED`（runtime.ts:4701）。

   两个 Skill 均能满足目标时，不会进行正式语义召回、质量/耗时/费用比较、LLM 最终选择和选择证据保存；Usage assessor 也不通过该分支执行。违反 FR-SKL-012、FR-LLM-004/005。通用 Goal→SkillGoal→Workflow 本身存在，不能据此说整个 Runtime 只能处理 UGV。

5. **P1：A2A stream 缺少完成结果及阶段更新的交互投影。已复现。**

   [task-service-executor.ts:117](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/a2a-adapter/src/task-service-executor.ts:117) 只发送一次完整初始 Task；[149 行](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/a2a-adapter/src/task-service-executor.ts:149) 后续只发 statusUpdate，遇边界就结束，不发送 artifactUpdate/最终完整 Task。queued→completed 的持久 Task 已有 output，流仍只有空初始 artifacts 和 COMPLETED。等待补充输入时也不重新投影新 interaction metadata。79–86 行 follow-up 处理后立即结束流。

   官方 SDK 不会从 statusUpdate 自动补齐结果；getTask 的持久化投影可读到结果，因此查询与流式行为不一致。影响 FR-A2A-005/010、AC-18。应使首次提交、follow-up、重新订阅的流式边界都能传递对应结果与可操作交互信息。

6. **P1：Skill 演化的新版本丢失原工具禁令和运行策略。已复现。**

   [skill-evolution.ts:403](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/application/src/skill-evolution.ts:403) 发布时统一写 `optional:[]`、`forbidden:[]`、`runtimePolicy:{autoConfirmPlan:false}`，不继承或审议旧版本预算、取消及补偿策略。已有版本加入 maxCost=1、maxMcpCalls=2、cleanup_workflow、补偿指导和禁止 erase_device 后，真实 SkillEvolutionService 的发布参数丢失这些限制。

   复现使用仓储/runner 替身，证明的是应用层发布逻辑。应区分新 Skill 与新版本，并保留或明确审议规范策略变化，不能通过演化隐式扩大权限或预算。

7. **P1：演化模拟和历史回放不验证完整候选 Skill。静态确认。**

   [runtime.ts:5147](/home/zhouwen/web-download/skill-driven-agent-runtime/apps/server/src/runtime.ts:5147) 只调用候选 tools[0]；5160 行丢弃返回值，未执行候选完整工作流、第二个工具、组合或 outputSchema 校验。[5183 行](/home/zhouwen/web-download/skill-driven-agent-runtime/apps/server/src/runtime.ts:5183) 回放历史 experience.workflow，未把候选 Skill 作为验证目标；[skill-evolution.ts:397](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/application/src/skill-evolution.ts:397) 所有此类门禁通过后自动发布。

   因而首工具成功、历史流程仍能跑，不足以证明候选修改正确。影响 FR-EVO-005/006。需要候选驱动的规划/执行/输出与证据验证，以及对候选修改的历史回归比较。

8. **P1/P2：合法循环和较长流程受 LangGraph 隐含 25 步限制。已复现。**

   声明 `maxIterations:30`、费用/时间/调用预算充足、validator=true 的 loop，只执行 12 次 body 后抛 GraphRecursionError。[workflow-compiler.ts:497](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/langgraph-runtime/src/workflow-compiler.ts:497) 的 invoke 未设置 recursionLimit，resume 和 continuation 同样遗漏；[workflow-validator.ts:138](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/application/src/workflow-validator.ts:138) 却允许循环上限 1–100。

   应让引擎步数限制与经过验证的图、循环和业务预算一致，保留明确的防无限执行限制。

9. **P2：DSL 校验漏掉必要执行语义，错误不能进入规划自动修正。已复现一个最小例。**

   loop 只有 loop 边而没有 done 边，validator=true；条件为 false 时立刻抛 `WORKFLOW_ROUTE_MISSING`。[workflow-validator.ts:312](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/application/src/workflow-validator.ts:312) 的检查及 586 行的 reachability 不要求该退出路由。缺边被拖至执行阶段才发现，应在生成/修正阶段拒绝。更广的环路、路由完备性和普通节点分支歧义仍需系统性补查，不能将未复现部分都视为确定缺陷。

10. **P2：Task Type 形成了知识模型，但没有接通初始任务识别。静态确认及索引复现。**

    [cognitive/task-type.ts:52](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/domain/src/cognitive/task-type.ts:52) 有 fingerprint、正反例、维度、criteria、Goal/DAG 模式、冲突约束、状态及版本；归纳与晋升有生产服务和 PostgreSQL 存储，active 类型会进入 [knowledge-search-repository.ts:232](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/persistence-postgres/src/cognitive/knowledge-search-repository.ts:232) 的规划知识检索。

    但 [runtime.ts:1949](/home/zhouwen/web-download/skill-driven-agent-runtime/apps/server/src/runtime.ts:1949) 给 GenericTaskUnderstandingService 注入 StaticTaskTypeIndexSource，未读取已归纳/晋升的 PG 类型。TaskTypeApplicabilityGuard 只有测试使用，在线简化类型也缺少正反例之外的完整约束。需要版本化 active 类型索引及适用性门禁；不能声称晋升完全无用，也不能声称在线闭环已完成。

11. **P2：managed_capability 的在线类型集合封闭，检索依赖固定短语。已复现索引行为。**

    [managed-capability-task-understanding.ts:5](/home/zhouwen/web-download/skill-driven-agent-runtime/apps/server/src/managed-capability-task-understanding.ts:5) 固定八个 vehicle 类型，并在 100/136 行强制 canonical set。[generic-task-understanding-service.ts:128](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/application/src/cognitive/generic-task-understanding-service.ts:128) 使用 hint 子串匹配；“无人车当前状态”命中，但“请查询一下这辆无人车的状态”无候选。profile 同时 requireKnownMatch=true，模型只能在供应候选中选，进而要求澄清。

    专用 UGV profile 存在合理，但不能把它的资格测试等同于跨业务任务理解泛化。应从正式 Task Type 与 Capability 注册表派生候选，并给同义表达与跨业务请求建立测试。

12. **P2：注册可把没有约束的 Schema 判作足够明确。已复现。**

    描述明确要求设备标识和状态，模型却返回输入/输出 `{type:'object',properties:{}}`。[skill-authoring.ts:214](/home/zhouwen/web-download/skill-driven-agent-runtime/packages/application/src/skill-authoring.ts:214) 仍判合法且足够明确，Authoring→Registry 生成 enabled@1，任意对象输出也通过 Ajv。影响 FR-SKL-003。应检查描述所需契约的明确性；不是一律禁止合法的无参数工具。

13. **P1：普通 subworkflow 的状态、持久化和预算不完整。静态确认。**

    [runtime.ts:3600](/home/zhouwen/web-download/skill-driven-agent-runtime/apps/server/src/runtime.ts:3600) 以临时 Executor 执行确认过的定义，使用系统默认预算，没有独立持久 child instance/lineage；3604 行只拒绝 failed，paused/waiting_external/canceled 均直接返回 outcome.result，父节点会将返回当完成。task_required MCP 还依赖在 2874 行获取持久 planDefinition，此路径缺少相应 instance。

    这与真实独立持久化的 skill_call 是两条不同路径。应把普通 subworkflow 也接到统一的子执行生命周期、父子预算和等待传播，不宜依赖 mock executeSubworkflow 的单测说明完整支持。

**其它范围与待补验证**

- 真实 LLM 取消传播：compiler 传了 signal，runtime.ts:2811 的 executeLlm 未接收/转发；model-runtime.ts:188 使用自身调用 timeout。静态链路显示 workflow 剩余时间/try_interrupt 不能即时取消在途模型请求；尚未跑真实 Provider。取消后不再执行后续节点与取消在途网络调用是两个不同承诺。
- 临时 Skill 失败/取消后失效：唯一自动 complete 位于 runtime.ts:4939 的成功增强路径且 successful=true；workflow-controller.ts:1048 在无 processedResult 时返回。未见等价失败/取消接线，需真实 DB 端到端验证后定级，不宣称已证明残留记录。
- UGV 纯文本 admission：ugv-natural-language-capability-admission.ts:55 只识别点导航和坐标，固定 a2a.embodied.move/ugv1；其它已公布操作还依赖显式扩展输入建立 binding。未执行完整 UGV 外部场景，列作静态泛化限制。
- Console 连接真实管理 API，不能称静态 mock。WorkflowPanel.tsx:91 的可视化编辑仅覆盖改名、入口/出口与边；增删节点、节点类型/参数仍依赖 DSL 编辑，图形化编辑能力有限。
- `verify-acceptance-map.mjs:5–23` 只检查历史报告中的 passed、18 个 ID 和非空 evidence/classification，未核对当前代码版本、证据文件内容或当前执行结果。本次该命令通过不能证明当前 18 场景被重新执行。

**“任务类型”必须拆开理解**

| 名称 | 权威语义 | 当前完整性 |
| --- | --- | --- |
| A2A Task | 标准状态、消息、context、结果及取消/继续生命周期 | 主体成立，stream 结果存在缺口 |
| Cognitive Task Type | 可归纳、晋升、检索的语义任务模式 | 定义与知识生命周期成立，初始在线类型识别未连通 |
| Skill taskBindings.taskType | ADR-104 规定的 MCP operation name 精确绑定 | 是工具操作约束，不能代替语义 Task Type |
| Task Capability / Exposure | 对外能力、精确 Skill/Provider 及执行 authority 绑定 | 有持久化与治理实现；profile 和 admission 的泛化程度需单独判断 |

**已经落地的基础，不应误判为空壳**

- A2A 官方 SDK 隔离、HTTP+JSON、标准状态、持久 Task 投影、查询、取消、follow-up、context 串行。历史 TCK 范围为 HTTP+JSON/MUST，74 passed/161 scoped skipped；不代表所有 transport。
- Skill Schema/描述/权限/运行策略，LLM authoring、草案发布边界、版本/启停/回滚、图谱；包路径与符号链接防护、checksum/UTF-8/大小限制，PG exact version 权威。
- guidance/template/procedure 汇入同一 DSL；原生 Usage 组合深度/allowlist；skill_call 独立子计划、版本、确认、状态、输出验证及远程等待。
- 受限表达式 AST；模型不生成并运行 JS/TS；确认后编译、structuredClone/deepFreeze、不变图；有限规划修正及外层新版本 replan。
- 初始人工确认、简单串行/条件/并行、小循环、远程等待的持久 frontier、已完成副作用不重放、Goal Patch 作废旧计划/结果及重新确认。
- Memory、五类质量评价、经验与演化服务、真实管理 API/React Console 均有代码和生产装配。模型输出的真实业务质量需与模拟验收分开看待。

**本次验证记录**

| 检查 | 本次结果 | 边界 |
| --- | --- | --- |
| TypeScript typecheck | 通过，exit 0 | 当前工作树，直接调用 tsc |
| Architecture gate | 通过，880 TypeScript sources | 静态依赖/领域边界检查，不验证行为语义 |
| A2A baseline verifier | 通过 | 校验协议 pin 与已保存 TCK 证据；不是重新运行官方 TCK |
| Acceptance map verifier | 通过 | 读取历史报告；不是重跑 18 AC |
| A2A/Task Type focused tests | 5 files / 38 tests 通过 | 见 a2a-tests.txt |
| Skill focused tests | 7 files / 66 tests 通过 | 见 skills-tests.txt |
| Workflow focused tests | 6 files / 109 tests 通过 | 子审计运行；文件列表如下 |
| 反例脚本 | Workflow 5 例、A2A、Schema、策略继承均成功展示缺陷 | 真实类 + 模拟依赖；不连接设备 |
| Lint | 失败，30 errors | 见 lint.txt；包含开发部署改动和若干已有源/测试问题 |
| Format check | 失败 | 两个已有测试文件不符合 Prettier，见 format.txt |
| 全量 pnpm verify 尝试 | 未完成，失败于 bootstrap 的子进程启动 EPERM | 在 /tmp 副本运行，共用现有依赖；未进入集成/E2E，不是 clean frozen-install 验收，见 full-gate-attempt.json |

Format 问题文件为 `apps/server/test/ugv-move-terminal-outcome.unit.test.ts` 与 `packages/langgraph-runtime/test/expression-interpreter.unit.test.ts`。审计没有修正它们。首次 pnpm 在副本中触发自动依赖检查，因 store SQLite 不可写失败；随后禁用自动依赖检查后 verify harness 的 spawnSync 仍报 EPERM。这些环境问题与上述已复现功能缺陷分开记录。

本次没有重新运行真实 PostgreSQL/Redis composed E2E、外部模型/Provider、设备任务、官方 TCK 或发布部署。现有全量报告对应 2026-09-02 的 `b7219f5`，当前 HEAD 和未提交改动不同。DoD 全勾选、历史 passed、当前源代码正确性是三件不同的事。

在仓库根目录复现：

```bash
python3 - <<'PY'
from pathlib import Path
root = Path.cwd()
staging = Path('/tmp/sdar-audit-repros')
staging.mkdir(exist_ok=True)
for source in (root / 'reports/code-audit-2026-09-07').glob('repro-*.txt'):
    (staging / source.stem).write_text(source.read_text().replace('../../', str(root) + '/'))
PY
node --import tsx /tmp/sdar-audit-repros/repro-workflow.mts
node --import tsx /tmp/sdar-audit-repros/repro-a2a.mts
node --import tsx /tmp/sdar-audit-repros/repro-skill-authoring.ts
node --import tsx /tmp/sdar-audit-repros/repro-skill-evolution.ts
```

脚本以 .txt 保存，避免进入产品 TypeScript/lint 文件集合。脚本是诊断反例，打印错误行为；exit 0 表示完成诊断，不表示产品缺陷已修复。它们使用内存/模拟依赖，不访问外部业务服务。`workflow-proof.txt` 为两段 JSON 输出，故不是单一 JSON 文档。

Workflow focused tests：`workflow-compiler.unit.test.ts`、`workflow-validator.unit.test.ts`、`workflow-execution.unit.test.ts`、`workflow-planner.unit.test.ts`、`workflow-controller.unit.test.ts`、`workflow-revision.unit.test.ts`。A2A focused tests：`task-service-executor.unit.test.ts`、`task-mapping.unit.test.ts`、`task-type-induction.unit.test.ts`、`generic-task-understanding.unit.test.ts`、`managed-capability-task-understanding.unit.test.ts`。

**建议修复顺序**

先修执行正确性与约束：并行汇合/终态、等待后确认、fail_fast、演化策略继承及普通 subworkflow。随后接通默认 Skill 选择和 A2A stream 结果，再将 active Task Type registry 接入在线识别。最后完善候选 Skill 验证、DSL 语义校验、循环预算与跨组合测试，并按当前源码版本重新生成验收证据。

应新增的验收重点是“条件×并行”“等待×确认×取消”“子工作流×远程 Task”“新版本×旧策略”“多 Skill×默认配置”“类型晋升×新请求识别”，而不仅为各模块分别增加正例。
