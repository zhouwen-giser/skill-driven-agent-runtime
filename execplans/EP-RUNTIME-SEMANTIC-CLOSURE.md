# EP: Runtime semantic closure after the 2026-09-07 code audit

Status: **Development scope complete / A/B/C 与同一冻结源码完整开发门禁通过；发布及延期项开放**。2026-09-07 用户批准以三个实现批次、一个开发完成验收点替换原 M0–M7 逐级验收。
Owner: 当前修复任务的主集成者；工作树基准为 `473ad7d82cb11eda530aaa46d77478850bd1e51e` 加审计时未提交改动。

## Current execution contract — 2026-09-07 revised scope

本节是用户最新批准的执行约定，替代下方历史 M0–M7 的执行顺序、逐里程碑完整验收和本轮全项关闭要求；原设计与证据保留用于追溯。只在本节更新当前批次状态。

- [x] 用户批准开发范围：Workflow/恢复、默认 Skills、A2A 流式与在线 Task Type，使用现有 API 完成业务闭环。
- [x] 原 M0 不再作为前置验收；复用已有隔离工具、依赖和诊断结果，不继续扩建验证设施。
- [x] 起步保护：自动处理及管理 API 演化发布入口阻断，保留经验/候选；已发布 Skill 和普通人工注册不受影响。
- [x] A（所属行为回归）：共享控制流分析 → 2.0 作用域编译 → 持久恢复/父子调用/取消。唯一汇合、3×2 循环、合法终止、零重复调用与预算保持均需真实行为回归。
- [x] B（所属行为回归）：正式默认选择、明确 Schema、临时 Skill 全终态事务失效。关闭 Cognitive 仍能选择并执行第二个兼容 Skill。
- [x] C（所属行为回归）：纯读投影和标准 A2A 流 → PostgreSQL 在线 Task Type/configured 来源 → 同 Task 澄清与正式 authority 绑定。不能补造资源或绕过明确权限拒绝。
- [x] 开发完成：A/B/C 相关回归通过后冻结源码，运行一次完整 reuse 聚合门禁；三类模拟业务、清理及当前源码证据通过。

执行顺序：起步保护 → A → B → C → 完整开发验收。开发中按缺陷运行所属套件，变化涉及相邻边界才扩大回归；禁止先逐项全跑再跑聚合门禁。一次全门失败后先诊断/集中修复，源码稳定再完整验收。文档仅做格式/引用检查。

延期：F06/F07 完整演化与原子发布、X04 完整 Console 编辑器、X05 发布级当前证据系统、全部18 AC发布证明、独立 frozen 安装验收及真实模型/设备验证。延期不等于关闭；本轮仅将 acceptance-map 历史 passed 判断改为结构检查。保持运行 DSL 不变、单 LangGraph、PG 权威、SDK adapter 边界；追加兼容迁移，不从 START 重放旧快照。

### 本轮实现与验证记录（持续更新）

- 演化保护：正式 Runtime 改为只读候选服务；simulate/corrections 均返回 `SKILL_EVOLUTION_PUBLICATION_DEFERRED` (409)，不触达模型、候选工具或版本写入。自动处理保留候选。服务 8 项、管理 API 对应契约 1 项通过；完整自动 Task 终态链仍待批次 B 验证。
- A 已实现：Domain 共享区域分析、2.0 fork/branch 汇合与调用级循环、递归步数界、checkpoint 会话保留、continuation 2.0/paused、模型调用方取消贯穿 HTTP。条件两路径 × 3×2 循环、远程两种完成顺序及等待后两次确认已有编译器回归；尚未作为默认规划语义启用，批次未关闭。
- PostgreSQL 0179 已验证：旧快照身份不变、2.0 scopes、paused attempt、带引用拒绝 down。隔离运行 `7f526833-a653-4696-8dd3-f06dd52e411e` 中 2 项仓储测试通过，五项清理退出码均为 0。此前迁移文件名不符合 Runtime 选择规则的失败保留在 `e8194d1c-f2be-4d93-a24c-aaa097270840`，已改为 `0179_v14_*`。
- 模型取消：Model Runtime 所属 unit 9 项、真实本地 HTTP adapter contract 5 项通过；取消不再触发替代 Provider 重试。
- A 进行中：0179 后追加 0180 通用父子关联，普通 subworkflow 接入持久 WorkflowExecutionService，Skill 查找改为 node-run。Skill 所属 unit 26 项已通过（随后暂停结果改动待复验）；通用子调用、取消树及 0180 仓储行为仍需验证。
- 这些是分次、不同源码状态的定向结果，不能拼成完整门禁。B/C 与最终一次开发门禁仍待实施。

### A 集成收敛补记

- 新规划候选现在使用 2.0（原定义不原地修改）；PG 计划读取 Schema 同步接受执行语义版本。嵌套 parallel、30/100 次循环和长链保留 1.0/2.0 两套行为回归；交叉 join 与跨区域 recovery 在工具调用前拒绝。
- 通用子调用已接入正式 Runtime；0180 中 Skill 记录与通用关联同事务写入，按 node-run 幂等。子等待进入确认时通过内部 `child_paused` 交接到父图同一调用，非终态不产生成功输出。父取消按实例沿持久关联向下传播，暂停期间停止执行预算计时与 deadline timer，恢复保留消费量。
- 2026-09-07 Workflow 相关 10 个 unit 文件 **186 项通过**；随后 SDK 配置隔离改动的 Compiler 所属文件 **62 项通过**。这些分次结果不是全量门禁。
- PG 0180 关联、事务回滚、幂等与受引用降级拒绝：运行 `3aec4779-949f-4a4a-85d5-c0f7ceca8497` 中 **3 项通过**，清理成功。新增迁移现补齐 BEGIN/COMMIT 与 schema_migration 登记，正在补验重复启动幂等。
- 普通 child 完整远程等待→父确认→恢复：运行 `d87b3c61-540e-48d3-9bda-eef71e33fd53` 中 **3 项 PostgreSQL/Redis 集成通过**，只有两个实例、一次工具调用、独立预算和 paused attempt，清理成功。SDK 公共 `runWithConfig` 隔离父子隐式 checkpoint 配置，使用已锁定 Core 1.2.2；Intake/ADR 已记录，无新依赖。
- 保留两次必要边界失败：`7fdfbeb2-b563-48c2-80a3-ec18cb6edc7d` 暴露 PG 读取 Schema 漏字段，`49fe0523-bc17-44cd-90d2-392e38c848c5` 暴露 SDK 父配置串入子 checkpoint；均由同一新增集成场景复验修复。

### B/C 集成收敛补记（2026-09-07）

- B：默认正式语义检索、结构化选择、Usage 与选择记录已装配，Cognitive off 不再走全部 Skill/第一项旁路。默认第二项选择的 E2E 3 项通过（`16943b19`）；共享 Schema 明确性与临时 Skill 0181 终态触发器已实现，失败/未知不计成功、回滚不留经验、终态不留活动临时版本。
- 演化延期端到端证明：三个实际临时 Task 完成后保留三个幂等经验与待验证候选；simulate/corrections 两入口均 409，候选工具调用为零、正式版本写入为零，完成 Task 不变失败。运行 `bb265f94-10c6-42c3-af25-2df7009c7554` 通过并清理。F06/F07 完整验证/发布仍延期。
- A/B/C PG 所属五文件运行 `65df444e-d1f3-4029-b966-39d95a401e3a`：97 通过、1 个旧静态 node ID 测试查找失败；修正为 node-run 查询后，`c35168bd-3cc7-4091-b766-ab08d61866d5` 两项通过（包括 0181 受引用降级拒绝与 up/down/up）。失败原始日志保留。
- C：纯读 TaskProjectionReader 与 SDK 公开 RequestHandler 统一 observer 已接通；revision/interaction hash/result hash 检测变化。GET/订阅零业务写入、同毫秒 metadata、follow-up、多观察者、断线重连和 Artifact 先于终态已有回归。SDK status message 通过官方 TaskStatus JSON codec，避免丢失消息 parts。
- C：0182 configured 来源/hash 与现有治理激活；未批准配置仅保留候选，批准后通过既有 promotion 事务。相同幂等键内容变化被拒绝，撤销不被重复配置重新激活。索引在有界 LIMIT 前过滤 task_type，模型只能选择当前候选精确版本。
- C：0183 持久澄清回执，补参后在同一 Task 上由现有 authority 原子提交 Binding/Attempt/queue/outbox；请求重试、过期输入、事务回滚已有 PG 3 项证明（`924c0e5f`，随后 65df 所属回归再次通过）。Skill 选择限制在已冻结绑定的精确版本，绑定输入直接进入 resolveExact，不重新猜测资源。
- C 两类软件业务链：`d04f82ef-0a7f-4e3c-ac47-0fce15505380` 两项 E2E 通过并清理。管理 API 激活 configured 类型，模拟模型选择非 UGV 文档/数据类型；文档纯文本请求→同 Task 补参→正式绑定→计划确认→一次实际模拟 MCP 调用→流式 Artifact/终态。聚合业务计算真实输入的 sum/count。保留配置维度、测试初始化连接及模型 fixture 解析失败证据，不用它们支持通过结论。
- 默认在线理解覆盖明确请求，但明确、无缺参请求不额外要求 Goal review；原模糊请求和显式交互 profile 保持原确认流程。缺参/权限确认永远先于执行。当前正运行所属完整 E2E 以验证默认入口兼容性。
- 最新边界 unit：Skill input、SDK observer、plan preparation 共 39 项通过。此前所属 unit 151 文件共 1351 项中 5 个 localhost EPERM 在许可环境定向复验通过；这些分次结果仍不能代替当前冻结源码全门禁。

日志根目录：`reports/runtime-semantic-closure/2026-09-07-m0-observable/post-bootstrap/`。以上均是开发定向/所属套件证据；最终完整 reuse 门禁尚未运行，开发完成框保持未勾选。

### 开发收口中的兼容回归

- 所属 E2E 首轮 `5e22d81d-6f19-4b27-aade-4e48196757ac` 保留 15 项失败；其中列表读取了过期 SDK projection，已改为 PG 当前 Task 状态/时间过滤后分页，再用同一纯读 mapper 返回内容。`5e95e0f7-d7aa-49b0-af4c-d555a6903181` PG 回归证明实时筛选与零快照写入，清理成功。
- 同步等待语义修正后，原来期望立即 working 的控制测试显式选择 `returnImmediately:true`，保留后续真实终态、工具次数、预算与权限断言。8 项失败定向复验通过（`be201490`）；另 5 项显式治理拒绝通过（`3f2ca564`）。延期后不再期待生成 Skill 演化 correction，仍验证 Prompt 修正、失败和评价经验。
- 递归巡检首次错误为共享分析把所有裸 goto 都认作无界。有限前向 goto 现在是普通结构边，回跳仍通过无界环检查；不擅自增加子调用重试，MCP recoveryOptions 原约束保留。Domain/Compiler/Usage 所属 81 项通过；2 项递归治理 E2E 在 `3684ba90-dd83-4e9e-ae2d-f79c71ce00e5` 通过并清理。
- Skill Usage 确定性新定义显式使用 2.0；示例 area_patrol 的 trajectory/anomalies 改为明确结构/受约束字典。移动用例自行导入依赖 Skill，消除依赖其他用例先运行的隐含条件。
- 配置激活按精确候选读取治理版本，不再依赖第一页 500 项列表；候选仍经原激活事务，无审批绕过。
- 所属完整 E2E 复验 `e3d5f0a2-c378-47db-8dcf-d5f1e762cd3f` 功能部分 6 文件、74 项通过；独立性能用例和清理仍在运行。本段不代替最终冻结源码全门禁。

### 冻结前最终相关证据

- `e3d5f0a2-c378-47db-8dcf-d5f1e762cd3f` 完整 E2E **75/75**（74 功能 + 独立 1 性能）通过，所有清理成功。原性能阈值未改：Runtime P95 变化 -6.27%，基线窗口漂移 12.95%（限15%），Evidence append P95 5.63ms（限20ms）。这些数值仅属本地模拟环境。
- `2514aa63-5548-452e-9a4a-2e7fa0983e09` 最后配置/澄清 PG **3/3** 通过并清理；审批独立于列表分页，事务和同 Task 幂等保持。
- 至此 A/B/C 所属行为回归齐全，开始 `pnpm verify:isolated` 默认 reuse 的一次完整开发聚合门禁；开发完成仍取决于该冻结源码结果及清理。不开新 M0、不重装依赖、不减少测试集合/阈值。

### 完整开发门禁失败与定向修复（保留历史）

- `f6b678f2-5767-4329-a173-6f72f1b1a999` 在 format 停止；修复 Skill Schema 文件格式。`4af4f50f-9059-4693-a5c0-4c83ffab1379` 在 lint 停止；修复在线候选读取的可选链写法。两次均清理成功，未运行的阶段不能记通过。
- `ca1b702d-37f6-4896-82a5-821cceb34b93` 完整 unit 2454 通过、1 失败：UGV 确定性入口漏声明 2.0。新定义入口补齐版本，旧示例不改写；相关 36 项通过，保留旧图结构及新版语义两项明确断言。
- `c3980ef2-a1ed-4d2b-a69c-460ad7fe2df3` 完整 unit **2477 通过**；contract 527 通过、6 失败，清理成功。根因是 DSL 条件 Schema 缺严格类型声明、迁移账本断言漏 0181–0183、收紧示例契约后测试校验和未同步。修复后完整 contract **61 文件、534 项通过**，新增 2.0 parallel 汇聚/冲突策略的 Schema 正反例。仅更新当前测试 fixture，不改历史验收报告或数据库版本。
- 反思：两次静态遗漏以及 Schema/包资源改动未及时覆盖所属契约，造成重复执行已通过前缀；这是执行选择的遗漏，不是放宽门禁的理由。后续修改 Schema、迁移或分发包时，最小相关验证必须包含其直接契约；集中修复已知失败后才重启全门禁。
- `77108544-da28-4474-90f8-6c23631eb402` 静态/构建、unit 2477、contract 534、76 项 Runtime 迁移通过；集成第一组 218 通过、2 项因 Skill 治理夹具初始化失败未执行，后续独立组未运行。夹具改为明确无参数输入和 evidence 输出契约，`6846178b-fc89-4b20-b174-10bf5ebaac47` 所属文件 2 项通过并清理；已通过的直接仓储历史 Schema 读取测试保留，不把新注册规则施加到历史读取。
- `d392a8ff-52bf-4da7-a8d3-4c3fab93b045` 进一步通过完整集成 **242**、E2E **75**、官方 HTTP/JSON must TCK **74**（原配置 161 skipped/30 deselected）、canonical evidence 演示与基础设施 smoke；Server/Console smoke 注册夹具的空输出契约被拒绝。夹具声明明确 status 输出后，`a75cfe9f-e789-40e8-a85d-1d4ef6f9bb8e` Server/Console 和 Node Control 两项 smoke 通过，五项清理均成功。Schema 收紧的直接消费者检查应包含启动 smoke 注册夹具；这次遗漏及成本保留，不能将失败全门禁与定向 smoke 拼成验收通过。

### 本轮 Outcomes / 最终开发验收

- 完整运行 `sdar-verify-b487014e-48c4-4de1-b2ce-1f3fae59de99`：`pnpm verify:isolated` reuse，**30 阶段全部通过**；unit 2477、contract 534、integration 242、E2E 75；官方 TCK 原配置 74 通过、161 skipped/30 deselected；canonical evidence 44/44 场景；三项 smoke 通过。
- `run.json` 的 exitCode/cleanupExitCode 均为 0，五项外层清理成功；运行输入及需求基线在快照内均保持不变，运行结束后当前工作树运行输入逐文件匹配。输入身份 `ce4bb0fb23c1d6761ce5eaa4e1d4f8b0fb60c90789f407bbf04c6ba517f02d10`。
- [本轮交付记录](../reports/runtime-semantic-closure/DEVELOPMENT-CLOSURE-2026-09-07.md) 汇总当前证据、三类模拟链和延期范围。下方早期“待完成/未运行”段落是当时记录，最终本节为准。
- A/B/C 开发范围完成；F06/F07、X04、X05 发布部分、18 AC、独立安装和真实模型/设备验证仍开放。本轮没有关闭旧计划全部 M0–M7，也不宣称发布完成。

## Historical original scope (retained; current contract above takes precedence)

## Purpose / Outcome

完成后，普通部署通过正式 Skill 选择生成合法计划；A2A 流式、查询和后续消息提供一致结果；
已治理激活的 Task Type 无需重启即可参与初始理解；DSL 的条件、并行、循环、子调用、远程等待、
确认和异常策略可以正确组合。Skill 演化验证候选的实际行为，保留旧规范策略，并以可重跑证据决定发布。

本计划覆盖审计 13 项发现及取消传播、临时 Skill 终态、纯文本 admission、Console 编辑和证据时效五项补查。
不以静态发现代替端到端证明：补查先建立测试；确认有缺陷则修复，证明不存在则保存反证和调用链。
本次计划不执行设备操作、不部署共享服务、不新增依赖、不改变 A2A transport/认证基线。
后续实现的默认验收使用真实隔离 PostgreSQL/Redis 与本地模拟 Model/MCP；外部模型语义质量单独分类。

## Requirements Covered

审计编号 F01–F13 与 `reports/code-audit-2026-09-07/README.md` 的编号一致。
X01–X05 是本计划的补查编号，不是新增或重编号的基线需求。

| 问题                            | 关联基线/既有增量                               | 实施阶段 | 关闭所需证据                                          |
| ------------------------------- | ----------------------------------------------- | -------- | ----------------------------------------------------- |
| F01 条件×并行汇合/错误成功      | FR-WF-002/003/006；FR-RST-003/004；AC-01/08     | M1       | 两种条件、嵌套/循环作用域、出口完成、汇合一次         |
| F02 远程等待后确认不可恢复      | FR-A2A-004；FR-EXE-002/005/008；ADR-088         | M2       | 同进程恢复、拒绝/取消、PG 状态一致、无重复调用        |
| F03 fail_fast 被 continue 覆盖  | FR-SKL-004/005；FR-MCP-012；ADR-099             | M1       | 模型越权决策不能继续，四类失败策略逐项验证            |
| F04 默认选择未装配              | FR-SKL-012/013；FR-LLM-004/005；AC-01/09        | M3       | 默认 main 配置、多候选选择第二个、指标/Usage/选择记录 |
| F05 stream 缺结果/交互          | FR-A2A-003/004/005/010；FR-EXE-003；AC-18       | M5       | 官方 SDK 消费 Artifact 后收到终态，与查询结果相同     |
| F06 演化策略丢失                | FR-SKL-004/005/006；FR-EVO-004/006/008；ADR-099 | M4       | 基线策略完整保留、规范变化留草案、并发 CAS            |
| F07 演化未测候选行为            | FR-EVO-005/006/007/008；AC-13/14                | M4       | 候选重新规划执行、第二工具/输出错误阻止发布           |
| F08 引擎步数限制不匹配          | FR-WF-002/009；ADR-023                          | M1       | 30/100 次循环、长链及嵌套预算边界                     |
| F09 DSL 路由校验不完整          | FR-WF-003/004/005；AC-03                        | M1       | 无效候选自动修正，执行前零 Tool 调用                  |
| F10 动态 Task Type 未接入       | FR-LLM-004/005；ADR-111/112/113；cognitive 增量 | M6       | candidate→治理激活→新请求命中→撤销不可用              |
| F11 静态八类/短语限制           | FR-A2A-001；FR-LLM-004；cognitive 增量          | M6       | 非 UGV 类型和未见中英文同义表达                       |
| F12 Schema 不够明确             | FR-SKL-002/003；AC-12                           | M3       | 开放空契约拒绝；无参数/受约束字典合法                 |
| F13 普通 subworkflow 生命周期   | FR-WF-002/009；FR-EXE-004/005/006；NFR-OBS-001  | M2       | 持久父子实例、确认/等待/失败/取消及独立预算           |
| X01 LLM signal 丢失             | FR-EXE-004/006；FR-WF-009；ADR-023              | M2       | 可取消本地模型 HTTP 请求、暂停与终止正确区分          |
| X02 临时 Skill 终态失效         | FR-SKL-014/015；FR-GOAL-007/008；AC-07          | M3       | 所有终态原子失效、经验幂等、失败不累积成功阈值        |
| X03 纯文本 Capability admission | FR-A2A-001/004；FR-GOAL-006；ADR-146/147        | M6       | 纯文本澄清后绑定现行 authority，确认前零执行          |
| X04 Console DAG 编辑            | FR-WF-010；FR-ADM-004；NFR-UX-001；AC-03/17     | M7       | 图形化节点/边编辑、校验、新版本确认与真实轨迹         |
| X05 验收证据过期/门禁失败       | docs/16、docs/17、全部 18 AC                    | M0/M7    | 当前源码身份、完整测试结果、严格证据校验              |

Goal Patch 作废与重新确认（FR-GOAL-003/004/005）、同 context 串行（FR-A2A-009）、
无自动重试（FR-EXE-008/009）和待执行队列恢复（FR-EXE-010）为所有阶段必须保留的横向回归。

## Context and Orientation

- `apps/server/src/runtime.ts` 是主要装配入口，多个缺陷来自服务存在但默认装配不完整。禁止把全部修复继续堆成
  这个文件中的业务条件；提取 Application 服务，runtime 负责依赖注入。
- `packages/domain` 拥有 Workflow/Skill/Task/continuation 数据；`packages/application` 拥有用例与端口；
  `packages/langgraph-runtime` 独占图执行；`packages/a2a-adapter` 独占 SDK 协议对象；PostgreSQL 是事实源。
- 已有独立 `skill_call`、外层 controller、SkillSelectionService、Usage assessor、Task Type promotion、
  Task Capability 和 validation execution context，均优先复用。
- A2A 生命周期 Task、Cognitive 语义 Task Type、Skill 中精确 MCP operation-name 绑定不可合并。
- 审计已复现八类行为错误，另有索引反例及静态问题；38/66/109 项相关测试通过仍不能覆盖这些组合。
  typecheck/880-source architecture 通过；lint 30 errors，format 两文件失败；全量尝试停在 EPERM。
- 当前未提交的 development deployment 工作及既有报告必须保留。不得 reset、清理用户改动或重启共享实例。

## Architecture and Interfaces

三份 ADR 与本计划一同落盘。2026-09-07 开始实施后接受 ADR-150；ADR-151/152 仍 Proposed，设计接受不等于实现完成：

- `adr/ADR-150-workflow-composition-and-continuation-repair.md`：分支作用域、terminal obligations、
  checkpoint/session、普通子实例、continuation schema、独立预算保持和 signal。
- `adr/ADR-151-skill-selection-and-candidate-validation-repair.md`：默认选择、明确性策略、基线策略、
  candidate validation scope、发布 CAS/事务、临时 Skill 终态。
- `adr/ADR-152-a2a-stream-and-online-task-type-projection.md`：标准流事件、纯读投影、active 类型索引、
  configured provenance 和候选输入与执行 authority 分离。

| 边界                                | 具体设计                                                                                                                     | 权威/兼容限制                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| DSL analysis → Compiler             | 共享纯数据控制流分析；新版 parallel 必须声明 joinNodeId 和 mergeStrategy=reject_conflicts；按 fork node-run/branch 编译 gate | 不在 Application 调度节点；不要求所有备选 exit 或所有 Workflow 必须有 result           |
| Continuation → session              | 保存 actual executable/thread/context/meter；paused handoff 是合法 attempt 结果                                              | 活动图不可变；普通 paused 进程丢失仍失败；远程等待只走既有 PG recovery                 |
| Parent → child                      | 通用持久 child link + typed result；Skill-specific 信息留在 Skill 服务                                                       | 不伪造 Skill；一个 lifecycle owner；ADR-023 的 child 独立预算与父固定成本保留          |
| Model port → transport              | optional caller signal 与当前 timeout 合并，外部取消后不再尝试其他调用                                                       | 不借本轮添加新模型 fallback 或改变阶段路由                                             |
| Default planning → selection        | 复用 retriever/decider/Usage/records；缺配置显式失败                                                                         | 关闭 cognitive 不关闭基础选择；已确认计划不补造 selection                              |
| Candidate → validation              | 内部 SkillValidationScopeRef 绑定 PG candidate/hash/run/case/mode，复用现有执行链                                            | 正式 DTO 不接受 scope；不临时 enabled，不向 live transport 回退                        |
| Validation → publish                | base exact version/hash + candidate hash + 新报告版本的 CAS/幂等事务                                                         | 保存 Skill/version/current pointer/candidate receipt/outbox 的原子关系；不削弱保护策略 |
| Task terminal → temporary Skill     | 复用 owning transaction 幂等 finalizeForTask；经验与终态一起提交                                                             | 模型归纳不在事务内；不能将同 Task 所有旧尝试记为成功                                   |
| Task read → A2A observer            | pure TaskProjectionReader，Task revision + interaction revision/hash + output hash                                           | 不调用 ensureHandoff；每条 stream 一个初始 Task，随后 Artifact/status                  |
| Active type → Understanding         | existing TaskTypeIndexSource 的 PG active projection + bounded recall + exact detail/guard                                   | 无新类型权威；空知识可回基线规划，但不绕过 Capability/Provider/confirmation            |
| Text candidate → Capability binding | resolved/clarification/not_applicable/rejected；接收 Task 后可补参并调用现有 authority                                       | 明确资源来源、精确版本与输入 hash；显式 formal metadata 错误不能偷偷回退自然语言       |

M6 的两阶段接收：新增轻量 request receipt（identity/hash、Task FK），保持现有 initial_task_admission
的“完整已绑定”语义；通过 `acceptForExistingTask` 在同一 Task/Context/revision 下原子写 Binding/Attempt/admission/outbox。
receipt 仅是幂等事实，不是第二生命周期。多 Skill 普通规划继续由 UserGoalPlan/SkillGoal 分解；不可把多 Capability
要求模糊折成一个 Exposure。当前一个 root Binding 的治理范围必须明确：多独立 governed Exposure 的请求返回可解释
的补充/拆分要求，不伪造跨 Exposure 权限；扩展其并发授权模型属于单独架构增量，不能在本轮暗中引入。

## Progress

- [x] 2026-09-07 用户批准后续完整实施计划；串行顺序 M0 → M1 → M2 → M3 → M5 → M4 → M6 → M7。
- [x] 2026-09-07 M0 验证基础设施子项：阶段实时日志/限时与进程组清理、分离输入身份、独立 frozen install 已实现；此项不代表 M0 完整基线通过。

- [x] 2026-09-07 完成审计发现复核与修复方案，明确问题→阶段→验收映射。
- [x] 2026-09-07 形成三份 Proposed ADR；识别 SDK 单 Task 流约束、paused attempt CHECK、独立预算兼容要求。
- [x] 2026-09-07 用户授权开始实施；保存当前源码输入摘要与工作树清单。
- [ ] M0：隔离验证环境、修复现有 lint/format 阻塞、保存可重跑基线。
- [ ] M1：控制流校验、分支汇合、终态完整性、循环步数及 fail_fast。
- [ ] M2：continuation 后确认、普通子工作流、持久父子状态与 LLM signal。
- [ ] M3：默认 Skill 选择、Schema 明确性与临时 Skill 全终态失效。
- [ ] M4：演化策略保持、候选完整验证、原子幂等发布。
- [ ] M5：A2A 纯读一致投影、标准流式结果与订阅生命周期。
- [ ] M6：在线 Task Type、注册来源、泛化 admission 与跨业务场景。
- [ ] M7：Console 补齐、证据校验重构、完整独立验收。

截至 2026-09-07 本轮进度复核，正式关闭 **0/8** 个里程碑。M0 验证基础设施已实现，19 项 runner/lifecycle 回归通过，但同一源码完整门禁尚未通过。最新 frozen 尝试 e5741fdb 的 2403 unit、531 contract、静态检查、build、migration 已通过，随后暴露迁移回滚测试遗漏 0178。
修复后的诊断 e170ef62 完整 integration **229/229**、E2E **73/73**（72 普通 + 1 单独性能用例）通过，五项外层清理均成功；这是诊断结果，不能拼接为完整门禁。

M1 仅首批 F03 失败策略、F09 condition/loop 唯一路由和 F08 初步步数/预算处理已编码；作用域汇合、3×2 嵌套循环与递归步数计算未完成。M2/M3/M5/M4/M6/M7 主体工作仍待实施。M0 排障顺带修复 X03 的明确权限拒绝被再次规划问题，不代表通用 admission 完成。
完整 gate 通过、traceability 和 evidence 更新后才关闭 milestone，不能以子项实现或旧测试总数替代。

## Discoveries and Surprises

1. `remote-task-continuation.ts` 不只丢 checkpoint，还将 paused 映射成 failed；Domain enum 和 PG CHECK 都需同步。
2. `SkillCallWorkflowService` 对实际 child paused 的处理也需修复，不能把现有 skill_call 当作完全正确的黑盒直接复制。
3. 固定 A2A SDK 的 lifecycle stream 禁止第二个完整 Task；正确输出是 Artifact 更新后 terminal status。
4. `InteractivePlanningSessionService.getByTask` 可调用 ensureHandoff；新增频繁 stream projection 前必须分离纯读。
5. ADR-023 明确普通 child 独立预算。本轮保留计费边界，只修解析、持续使用和父级期限/取消传播。
6. configured 类型不能冒充 induced/fixture，也不能借 SQL seed 绕过既有 G00/promotion 门禁。
7. 验收 map 现在读取历史 passed；若改成要求当前 run 而仍放在 bootstrap，会产生“验收尚未运行却要求其报告”的循环。
   需分离结构检查与本轮执行证明检查。
8. compose.yaml 固定项目名 sdar，测试脚本有固定 gate 数据库名和 force-recreate。隔离不能仅换 cwd；必须隔离
   project、端口、PG/Redis/队列命名与测试配置，验证脚本不读共享 .env。
9. 现有 SkillCallWorkflowRepository 按 parentInstanceId/parentNodeId 查找，旧表主键也只有静态节点身份。
   M2 必须同时迁移为 node-run 幂等身份，否则循环再次调用同一 Skill 节点会复用旧 child。

10. 恢复入口原先会裸抛预算耗尽；统一 invoke/resume/continueExternal 的预算失败结果，保持已消费计数。
11. TCK/smoke 客户端原先硬编码 9999/9998；隔离 runner 分配端口，并必须等自己启动的子进程 ready 后才查询其本地地址。
12. 沙箱阻止 listen 并使子进程 stdout 契约失败；相同四项契约在许可环境全部通过，未削弱断言。
13. 第二批分阶段运行显示 format 62525ms、lint 176368ms 均通过；旧 600 秒聚合超时暂不能定位为单步骤错误，后续阶段继续取证。
14. 独立快照首次 unit=2375 passed/3 failed：一项旧环境断言与 README/template 的 development 不符，两项遥测测试依赖相邻仓库文件。修正断言并补充六项字节快照输入（不复制 .env），全部纳入运行 hash。协议检查的历史 Git blob 通过独立 bare clone 提供；不挂载共享 .git。
15. `generate-v13-release-evidence.mjs` 依赖旧聚合阶段名称；新增版本化报告 reader，当前拆分报告必须具备全部 bootstrap 阶段及指标，不能从历史补齐缺项。

## Decision Log

2026-09-07 已确认：新语义嵌套循环按调用重置，3×2=6；parallel 显式汇聚和冲突策略遵循原始 SRS。纯 DSL 自动修正遵循 FR-WF-005，不重复确认；实质 Goal/权限/输入/规范变更遵循既有确认规则。

| 日期       | 决策                                                | 原因                                 |
| ---------- | --------------------------------------------------- | ------------------------------------ |
| 2026-09-07 | 修复现有单 Runtime，不引入库/第二编排器             | 保持基线与领域边界                   |
| 2026-09-07 | 先做执行正确性，A2A/Skills 可独立开发，集成顺序明确 | 优先消除错误成功、无法恢复和策略绕过 |
| 2026-09-07 | 保持 child 独立预算；不做全树累计额度重定义         | 避免静默推翻 ADR-023                 |
| 2026-09-07 | continuation 新版本写入、旧版本只读/可证明转换      | 不篡改历史 hash、不重放副作用        |
| 2026-09-07 | 自动演化只在规范边界内发布；修改规范走原管理流程    | 同时满足 FR-EVO-008 与 ADR-099       |
| 2026-09-07 | 线上类型读取现有 PG/promotion，不另建静态类型权威   | 接通闭环并保留真实 provenance        |
| 2026-09-07 | 历史验收报告保留；当前结论必须绑定源码与 run        | 防止旧证据替当前版本背书             |

## Implementation Steps

### M0 — 验证基线与隔离环境

第二批执行约定：将 bootstrap 分阶段串行输出并立即保存结果。format 5 分钟，lint/typecheck/unit 各 20 分钟，contract/build 各 10 分钟，其余阶段保留既有限时；unit/contract 最多两个 worker。记录命令、退出码、超时、资源采样及清理结果。运行输入与需求基线分别 hash，状态文档和生成报告不参与运行输入。保留 reuse 模式，新增独立 frozen install 模式，最终验收必须使用 frozen 模式。超时/取消清理本次进程组和独立 Compose 项目；失败与未运行阶段不得报告通过。

文件：`scripts/lib/infrastructure.mjs`、`scripts/verify-full.mjs`、`scripts/test-{integration,e2e}.mjs`、
相关 smoke/migration/TCK runner、`eslint.config.mjs` 及审计 lint/format 指向的具体文件。

先生成源码输入 manifest（含未提交源、测试、迁移、契约和 lockfile；排除秘密、依赖目录和生成报告），
保存已有改动清单。迁移 audit 反例到各 owning test 文件时先运行红灯，再随对应修复转绿；不得保留 skip/todo。
M0 保存反例诊断但不把所有尚未修复的反例先混进全量绿色结果。

补齐验证 runner 的显式 isolated project/config/run ID：独立 PG/Redis 实例、端口、队列和数据库名，所有清理
限定本次拥有资源。禁止读取共享 development .env、连接现用数据库或使用 sdar 项目 force-recreate。
使用已锁定依赖和镜像；在可执行 Node/Docker 的隔离 runner 重现此前 EPERM，区分环境权限与真实代码失败。
不能用停用测试/strictness解决。对 lint 的 Node globals 使用显式 import 或准确配置，不全局关闭规则。

关闭条件：现有 format/lint/typecheck 通过；隔离全 gate 可运行并保存真实结果；重复 baseline 不改共享服务/数据。
即使旧测试全过，F01–F13 状态仍开放。

### M1 — 图语义与运行边界

文件：`packages/application/src/{workflow-validator,skill-usage-planning}.ts`、
`packages/langgraph-runtime/src/workflow-compiler.ts`、`packages/domain/src/{workflow,workflow-continuation}.ts`、
DSL schema、`packages/persistence-postgres/src/workflow-continuation-repository.ts`。

1. 共用控制流分析：检查 condition 两类路由、loop body/done/受控回边、human success/failure、重复 handler/branch、
   普通节点模糊出边及无界环；兼容有界 error-recovery goto。非法候选给结构化 code/path，进入现有 planner correction。
2. 新执行语义必须显式 joinNodeId + mergeStrategy=reject_conflicts；唯一汇聚/分支归属校验；按 fork 调用与 branch 身份汇合。旧版本仅在可证明等价时转换为 successor，不改写旧 hash。冲突输出显式失败并保留来源。
3. terminal obligations：验证选中成功路径、活动分支关闭和声明输出；保留多个备选 exit 和非 result exit。
4. 循环按每次调用重置当前迭代（外层 3 × 内层 2 = 6 次动作）；预算消费不重置。递归计算区域/嵌套循环/恢复的 superstep 上界，安全整数运算和复杂度上限；替换首批全局求和估算。
5. 将 Skill failure policy 转成模型可选动作边界；fail_fast 只可终止；optional/degraded/recoverable 遵守既有规范。
6. 对 continuation join 状态增加版本，保留旧 reader 和不改写 hash 的 successor 转换。

关闭条件：审计 F01/F03/F08/F09 正式 regression 转绿；循环中的 parallel 不复用旧 arrival；两远程分支不同返回顺序、
重复回调均只汇合一次；非法图零 Tool 调用，预算/取消不能被 handler 吞掉；完整 gate。

### M2 — 异步恢复、子实例与取消

文件：Compiler/Executor adapter、`packages/application/src/{workflow-execution,remote-task-continuation,
skill-call-workflow,model-runtime,ports}.ts`、Domain continuation/child records、对应 PG repositories、runtime.ts。

1. 保存实际执行 session（图/thread/context/meter）；initial、resume、continueExternal 一致注册、保留和清理。
2. continuation attempt 增加 paused；同步 PG CHECK、时间字段、Task/controller 投影和 consumed event 处理。
   human wait 与尚未结束的其它 remote waits 分别保留权威；确认不能重复消费 remote resolution。
3. 新建通用 parent-child lineage，迁移 Skill 专有链接为引用/投影，普通 subworkflow 通过 WorkflowExecutionService
   执行，不再临时 new Executor。用 typed outcomes 传播等待/确认/失败/取消，禁止 undefined 代表完成。
   幂等唯一键为 `(parent_instance_id, parent_node_run_id)`，childInstanceId只作独立引用，不能纳入幂等键。
   同步修改 `ports.ts`/`skill-call-workflow.ts` 的静态节点查找、确认查询及0034旧主键的后续迁移；
   无法证明run归属的历史记录保留legacy身份，不能猜测其属于后续循环。
4. 从 confirmed definition 的实际 Skill policies 解析 child 独立预算；恢复保留使用量，parent call cost 只记一次。
   parent active deadline/cancel 跨 child 传播，暂停计时沿用既有规则。
5. LLM port 转发 signal，ModelRuntime 合并 caller/provider timeout；外部 abort 后不重试/切换继续。
   可取消读取节点按原暂停语义重入；不确定副作用保留 exact reconciliation/no-replay，不能用重调模拟暂停恢复。

关闭条件：remote→confirm→remote→confirm；普通 child 和 Skill child 的确认/拒绝、pause/cancel、父 Goal Patch、
进程丢失；PG instance/attempt/binding/Task 一致；调用计数与预算准确；完整 gate。
同一node-run并发/确认/continuation重入只创建一个child；同一静态节点两次循环必须创建两个child，分别验证输入、输出和预算。

### M3 — 默认 Skill 路径与生命周期

文件：runtime.ts/main.ts/environment.ts、`skill-goal-scheduler.ts`、`skill-authoring.ts`、`skill-registry.ts`、
新增共用 `skill-schema-contract-policy.ts`、`temporary-skill.ts`、Task 各终态 owning repositories。

1. 普通 main 配置创建现有正式选择服务；profile off 只关闭附加理解，不关闭选择。使用 exact selected record，
   删除 first-compatible fallback；legacy 使用原 Usage 投影，专用 exact profile 保留其 authority 及来源记录。
2. 共用 Schema 明确性规则：拒绝开放空 schema/伪约束字段；允许明确无参数 closed object、受约束动态字典与
   有界 local refs/combinators。模型给出 fieldCoverage，机械校验字段路径/required 与补充说明。旧版本只告警复核。
3. 先验证临时 Skill 的失败/取消残留；在当前 Task 终态事务内 finalizeForTask，幂等提交 expired/experience/outbox。
   覆盖成功、失败、直接/Goal取消、等待超时、process loss、Goal Patch 失效；成功只归属实际成功的临时 attempt。
4. 成功后 enhancement 只消费已提交触发，不决定失效。历史 active+terminal 修复按真实证据标记；未知不计成功阈值。

关闭条件：默认启动模型选第二个兼容 Skill，选择/指标/Usage/确认齐全；Schema正反例通过；所有终态与回滚/并发测试
证明一次失效一次经验；不关闭任何不相关 Skill；完整 gate。

### M4 — 演化候选验证与发布

文件：`packages/domain/src/temporary-skill.ts`、`packages/application/src/{skill-evolution,skill-registry}.ts`、
扩展 SkillSimulationRunner 与内部 validation scope、提取 `skill-simulation-service.ts`、对应 PG transaction/repositories。

1. new_version 冻结 base exact version/hash/effective policies，保留工具、runtime、native normative/Provider/context/
   evidence/visibility/composition/outcome 保护字段；模型提出规范变化留草案。new_skill 必须有明确有界策略与来源。
2. Candidate root 以内部 validation scope 解析；child 仍来自正式 Registry。复用规划、Usage/DSL校验、LangGraph、
   结果与 Outcome/证据检查；静态失败不进入执行。simulation/replay 指向隔离本地 transport，禁止仅靠 header 宣称隔离。
3. 所有历史/补充 case 以候选重新规划执行；历史图作对照，候选输出、证据和稳定错误条件是 oracle。
   验证“第二工具失败”“指导改坏”“Schema不匹配”“child等待/失败”，不能只看第一工具不抛错。
4. 新版验证报告绑定候选、依赖、模型/Prompt、case/plan/instance/断言；所有 required case 通过后，
   CAS + 幂等 transaction 更新 Skill/current pointer/candidate published receipt/catalog outbox。
5. 验证中 base被更新/禁用、候选被编辑或发生响应丢失，拒绝过期发布或复用同一完成 receipt，不能创建重复版本。

关闭条件：F06/F07 及完整保护字段回归通过；所有失败均不改 current；exact一次发布；候选从未提前 enabled；
真实PG证据可导航，live transport 调用数零；完整 gate。

### M5 — A2A 标准流式与纯读投影

文件：`packages/a2a-adapter/src/{task-service-executor,task-mapping,http-endpoint,postgres-task-store,
replay-safe-event-bus-manager}.ts`、task-state-notifier、纯读 projection service、interactive-planning-session-service.ts。

先针对固定 SDK public RequestHandler/event 接口做最小 contract spike，保留标准错误、Message-only 和 idempotent
replay。禁止改 SDK 或在 lifecycle stream 追加第二 Task。依据 spike 用 adapter observer/handler decorator 实现统一观察。
这一步是实现路径验证，不允许改变最终协议序列与验收行为。

每连接一次初始 Task；随后 status/interaction metadata 更新；输出使用 stable Artifact ID、append=false/lastChunk=true，
先 Artifact 再终态。follow-up 回到共同观察流程；同步 wait window 与订阅 lifetime 分开；disconnect 只销毁 observer。
投影使用真实 Task revision/interaction revision/output hash；新增纯读 interaction snapshot，ensureHandoff 仅由command/reconcile执行。

关闭条件：无需额外 getTask 的官方 stream 客户端拿到 text/data；查询/stream/follow-up/resubscribe一致；metadata-only
变更不丢；同毫秒更新、多观察者、断流、并发 follow-up、失败/取消均正确；GET/订阅零写入/零MCP调用；完整 gate/TCK。

### M6 — 在线类型与跨业务 admission

文件：`packages/application/src/cognitive/{generic-task-understanding-service,task-type-applicability-guard,ports}.ts`、
Domain cognitive type/snapshot、现有 PG cognitive repository/search/promotion、managed-capability 配置、
`task-service.ts`、`task-capability.ts`、request receipt/admission repository、management configured import入口。

1. ActiveTaskTypeIndexSource 从现有PG/promotion读取当前有效版本，先过滤状态/scope/public Capability，再有界
   关键词/语义召回；小目录可供应全部合法候选。模型只选精确版本，加载完整约束并验证，不靠固定短语硬筛。
2. Understanding冻结 type revision/hash/promotion ref、候选/guard结论、catalog hash及模型决策；缺维度澄清、冲突拒绝。
   阶段知识故障回基线正式选择；既有 required capability checks 继续生效。
3. configured origin与来源hash/审查证据进入现有类型生命周期，导入先candidate，经既有G00/promotion激活。
   禁止从8个静态数组直接伪造active。保留明确UGV资格profile，managed generic不再强制车辆canonical set。
4. 请求先幂等持久接收、再Understanding/澄清、最后acceptForExistingTask创建正式binding。
   候选只可引用当前public Exposure；模型不选Provider凭据、不补造resource。绑定前重新核对Schema、版本和authority。
5. 显式结构化协议兼容；纯文本修改绑定后的输入走Goal Patch/新计划/新确认。多独立governed Exposure范围按上方边界明确处理。

关闭条件：新增非UGV configured/induced类型candidate不可见、激活后无重启识别、撤销后新请求不再使用；
空知识库仍可跑正式通用链。document.summarize、dataset.aggregate、现有设备只读链完成；
未见中英文表达、补参/歧义、并发重复/冲突、候选后authority变化、确认前零模拟写入均有E2E。完整 gate。

### M7 — 可操作界面与当前版本验收

文件：`apps/console/src/WorkflowPanel.tsx` 与其测试、必要管理校验接口；`scripts/verify-acceptance-map.mjs`、
`scripts/verify-full.mjs`、acceptance结果生成器、docs/16/17、相关API/运行/升级文档。

Console增删节点/修改类型和参数/编辑边应生成受验证DSL草案，保留未知可兼容字段；运行图只读，新版本才编辑执行。
显示真实父子等待、确认、预算和失败证据；浏览器走编辑→校验→新版本确认→执行/回放，不能只断言文本包含按钮。

验收分两步：bootstrap仅检查schema/需求与测试映射；E2E完成后从当前run的机器结果生成AC记录并验证证据。
报告绑定源码manifest/hash、lockfile、Node/pnpm、镜像、迁移、测试名/断言、run ID和日志hash。
前后源码输入不一致则失效；缺文件/失败case/旧hash/伪passed报告必须拒绝。排除生成报告自身避免hash自引用。
按run保存所有尝试，latest-attempt与latest-passed区分，历史报告不覆盖；旧passed不能替代当前hash。

关闭条件：所有F/X项有关闭证据或明确反证；当前完整18 AC及新增组合/跨业务矩阵全部通过；
独立干净checkout frozen install + pnpm verify；未选择的transport/真实设备分类明确；docs/16/17与实际一致。

## Validation

每个 milestone 关闭时执行一次完整聚合门禁；以下命令是替代入口，不能先逐项执行全部子阶段后再重复聚合执行：

```bash
# 常规里程碑：隔离源码与服务，复用已锁定依赖
pnpm verify:isolated
# M0 完整基线和 M7 最终验收：独立目录、独立依赖安装
pnpm verify:isolated --frozen
```

聚合门禁自身覆盖 format、lint、typecheck、unit、integration、contract、E2E、build、
architecture、protocol/TCK、evidence、migration 和 server/console/control smoke。
常规里程碑也可使用 frozen 模式，但开发中每次小改都重新安装没有必要。

### 2026-09-07 执行复盘后生效的验证节奏

1. 每个缺陷先明确可观察的行为与 owning test；运行最小失败用例，修复后运行该套件。跨层改动增加相邻边界验证，不按测试总数判断功能完成。
2. 诊断阶段复用一份稳定的独立工作目录及依赖。lockfile、安装配置或运行环境变更时重新安装；复用目录不承担最终验收证明。临时依赖清理前核对仍在使用的链接，避免再次制造 ENOSPC/断链排障。
3. 基线尚有未执行的阶段时，按依赖顺序单独诊断，汇总相互独立的失败后集中修复；环境启动失败时不继续产生无意义的下游失败。此诊断过程不启动另一轮全量门禁。
4. 已知失败对应套件全部通过、未探索阶段已诊断、源码停止修改后，再冻结源码启动完整门禁。完整门禁中不并行开展会立即使本次源码失效的修补；新发现记录到下一批。
5. 完整门禁失败后保留日志，先修复并重跑失败套件。只有新改动涉及的边界仍有风险时扩大回归；批次稳定后重新完整验收，不为每个小改重跑前缀。
6. 测试用例保留必要的分支、状态、事务、幂等与预算边界。多个输入只重复同一不变量时优先参数化；已有行为回归充分覆盖的实现细节不再叠加镜像测试。不可删除需求场景或削弱断言来提速。
7. 文档/进度修改只检查格式和引用；无运行行为变化不触发 unit、TCK、数据库重建或 production build。文档状态不参与 runtime hash；需求基线变更仍必须重新评估其影响。
8. 每个里程碑仍须同一源码完整门禁；M7 仍须 frozen install 和本次全部 AC 证据。复用环境和定向结果仅用于诊断，不能借旧 passed 关闭里程碑。

| 改动范围                | 开发中的必要验证                                                  | 不再逐次重复的验证                                                  |
| ----------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| M1 控制流/汇合/循环     | Domain/Validator/Compiler 行为回归；真实 LangGraph 组合及调用计数 | 无关 Task Type、演化、官方 TCK 和全套部署 smoke                     |
| M2 恢复/父子/取消与迁移 | 状态迁移、PG 事务/唯一键、重复回调与零重复调用                    | 每次小改重跑全仓库静态前缀、全量 E2E                                |
| M3/M4 Skill 链路        | 默认真实选择、完整候选执行、全终态与发布竞态                      | 只因纯 Schema 断言调整而重建全部部署                                |
| M5/M6 A2A/Task Type     | 官方客户端实际结果、纯读零写入、激活/撤销与权限边界               | 未改 transport 时反复全套 TCK；用 harness 通过替代真实 Runtime 结果 |
| M7 Console/验收         | 实际 API 编辑与轨迹、当前证据拒假、完整 frozen 验收               | 同一快照先手动全跑子阶段再跑聚合门禁                                |

模型取消验证用可观察Abort的本地HTTP模型，工具模拟真实读取测试文档/聚合数据，不直接返回固定最终答案。

| 必须的交叉验收                                    | 可判定的结果                                               |
| ------------------------------------------------- | ---------------------------------------------------------- |
| condition × parallel × loop                       | 互斥路径不互等；每次fork只汇合一次；合法exit与结果满足声明 |
| wait × human/child confirmation × cancel          | confirmation前无新副作用；resume不重放；拒绝/取消终态一致  |
| subworkflow × task_required MCP × budget          | 持久父子链完整、独立限额正确、恢复不重置/重复计费          |
| fail_fast × 模型continue；budget × handler        | 越权决策稳定失败，预算/取消不可吞                          |
| new_version × old normative policy × publish race | 保护字段保持，过期候选不切current，一次发布                |
| default deployment × two compatible Skills        | 模型选第二项，实际版本/usage/selection与证据一致           |
| Task Type promotion × new request × deprecation   | candidate不见、active可选、撤销对新请求生效，无需重启      |
| stream × follow-up × resubscribe × metadata-only  | 标准序列、最终输出一致、纯读无handoff副作用                |
| terminal Task × temporary Skill × crash/rollback  | 一次失效一次经验，不从未知/失败积累成功                    |
| document/data/device-read × held-out paraphrases  | 真实数据结果可独立验证，业务选择不依赖UGV硬编码            |
| source mutation × stale report × missing evidence | 验收拒绝，不可伪造passed                                   |

实施命令：`pnpm_config_verify_deps_before_run=false pnpm verify:isolated`。每次生成独立源码快照和输入哈希，
不复制本地 .env，不继承共享应用配置；隔离实例/端口/TCK 工具目录与报告均以 run ID 分开。
本地沙箱 listen EPERM 尝试保留；一次许可环境运行在发现旧固定客户端端口后主动中止，cleanup=0，不能当作 gate 通过。
完整结果见 `reports/runtime-semantic-closure/2026-09-07-m0-m1/README.md`。
早期历史 run `sdar-verify-6c45def7-7808-45b2-b82f-98ca62ae2bbe` 输入 hash 为 `b8255f54abdef53174da16129f511fa231f6c81f63caaed457c3178008189e35`，
静态阶段 ETIMEDOUT/601399ms，format 和隔离四契约已过；后续 integration/E2E/build/smoke/TCK 尚无本轮证明。

## Idempotence and Recovery

- 不覆盖既有ADR/迁移/历史报告；新迁移实施时分配当前连续序号（审计已到0178），含up/down、旧数据兼容和repository测试。
- M1/M2预计需要snapshot版本/paused CHECK/common child lineage迁移；M3需要临时经验终态ref/幂等约束；
  M4需要base/hash/versioned validation及发布receipt；M6需要configured origin/snapshot/receipt。已有JSON字段可容纳则复用，
  不新建重复authority。实际DDL在对应阶段ExecPlan记录准确文件名后执行。
- 升级先运行只读active snapshot/child/candidate兼容预检；不明旧snapshot保留失败证据，不从START恢复。
  普通running/paused不因新代码恢复；现有可证明remote wait仍按PG权威处理。
- 新字段/版本存在活动引用时down拒绝；通过兼容reader或前向修复解决，不删记录/清空库回滚。
- Skill发布、临时Skill失效、两阶段admission使用唯一键/CAS及同事务receipt；重试不能重复副作用或重复版本。
- 运行中definition、Skill版本、确认和binding不热改；Goal Patch按原事务失效所有旧计划/结果/确认。
- 共享runtime/PG/Redis/设备不作为测试资源。后续部署必须附精确源码、迁移预检与结果，不能拿本计划当部署证明。

## Artifacts and Evidence

- 原始审计：`reports/code-audit-2026-09-07/README.md`、同目录反例与结果；保留只读历史。
- 实施证据写入 `reports/runtime-semantic-closure/<run-id>/M0` 至 `M7`，每次尝试保存manifest、命令、exitCode、
  测试身份、结果、分类与hash。最终另产出 `final-acceptance.{md,json}`，不能预先写passed。
- 每阶段更新本计划、PROJECT_STATUS、CHANGELOG、docs/17；遇真实需求歧义更新docs/18及对应ADR。
- 计划中的新服务/测试/报告路径是拟新增，不代表当前已存在或已验证。

## Outcomes and Retrospective

2026-09-07：交付8阶段修复计划、三份Proposed ADR、需求映射和组合验收标准。产品代码未修改；
审计缺陷仍开放，全部实施checkbox未勾选。没有运行新的发布验收或修改共享环境。

实施依赖：`M0 → M1 → M2`；M3与M5可在M0后独立开发；`M4 ← M1/M2/M3`；
`M6 ← M3/M5`；`M7 ← M1…M6`。M1/M2共享snapshot契约需同一人协调；runtime.ts、migration序号、
docs/17和release evidence由主集成者统一合并，避免多个子任务竞争写同一装配点。

首批实施建议是M0与M1。完成时间取决于隔离runner及新增回归暴露的问题，当前不作未经实现验证的工期承诺。

2026-09-07 实施批次：完成上述 M0/M1 子项和回归，完整里程碑仍未关闭。未修改共享服务或执行设备任务。

2026-09-07 M0 第二批：九项 runner 回归与三文件23项配置回归通过；第一次分阶段 full gate 单元失败已保存，cleanup=0/输入未变。新 frozen run `sdar-verify-47146855-054f-4610-a9ae-c8684ce2c899` 独立安装290包通过，完整门禁执行中。详见 `reports/runtime-semantic-closure/2026-09-07-m0-observable/README.md`，不关闭M0。

2026-09-07 frozen run 47146855：2400 unit 全过，contract=530 passed/1 failed（旧迁移后缀未纳入已有0178），cleanup=0。已补齐断言且三项定向契约过；发现并修复 Node Control 两个嵌套 Compose 项目的外层超时清理。静态测试映射/冻结契约虽然位于reports也必须纳入runtime hash。第三次完整frozen gate启动，M0仍开放。

### M0 verification follow-up, 2026-09-07

Frozen run `60048430-57a7-4b09-8419-7ff34a9e2776` passed all bootstrap stages and migration verification, then failed integration (206 passed / 1 stale terminal-recovery polling assertion). Corrected the expected terminal handoff and strengthened duplicate-event/no-repeated-tool evidence. Full results and previous attempts are retained under `reports/runtime-semantic-closure/2026-09-07-m0-observable/README.md`; no milestone is closed. Cleanup review additionally binds raw migration containers/volumes to the outer run and preserves cleanup failures; 17 runner/isolation regressions pass. Remaining stages are being exercised in a separate diagnostic copy before the next complete frozen run.

M0 baseline recovery also exposed a real X03 edge while replacing an invalid simulation response: a failed Workflow carrying MCP_CONTROL_AUTHORITY_REQUIRED could enter Goal evaluation and produce another awaiting-confirmation plan. The controller now fails that control with the original denial before any evaluator invocation. Three new unit cases cover achieved/unachievable/adjust-plan suggestions (24 controller tests pass); the seven ungoverned E2E variants retain failed-state and zero-Provider-call requirements. This is a narrow early prerequisite for M6, not M6 closure. Service teardown now waits for the owned Runtime process before dropping its database; 19 verification runner/lifecycle tests pass and the corrected Node Control smoke passed with no forced-database-disconnect error. Final full frozen verification remains required.

### 2026-09-07 用户要求的进度与效率复盘

复核七次 schemaVersion=2 full 尝试，记录的门禁执行时间合计 3,481,545ms（58.0 分钟，不含独立安装、诊断和分析），其中两次因后续修补使源码过时而主动取消。不能把 58 分钟全部归为浪费，但未排清后段失败便重复运行前缀、六次 frozen 安装以及过早并发启动完整门禁，确实属于可避免的执行成本。验证基础设施投入过多，M1 及后续核心能力推进不足，由执行者承担节奏调整责任。

必要验证发现了真实的权限拒绝重规划、子进程退出/清理问题，也暴露了陈旧测试假设；这些回归应保留。低价值的是重复频率与覆盖范围，以及把协议 harness/历史证据通过当作能力进展，而非测试本身都无用。原 601 秒聚合超时缺少分阶段记录，不能事后断言具体根因。

诊断 e170ef62 已完整结束：integration 229、E2E 73 全部通过，清理无失败，当前没有验证进程继续运行。下一执行检查点是冻结已排除已知失败的 M0 源码，完成一次完整 frozen 门禁；通过后按既定顺序转入 M1 的唯一汇聚、激活身份、3×2 循环及终态义务。每次汇报列出已完成行为、待实现行为与实际关闭数，不再用累计测试数替代进度。

### B 默认链路与 C 流式首轮证据（2026-09-07）

- 默认部署已装配正式 SkillSelectionService、pgvector/ModelRuntime embedding、结构化选择、Usage 与选择记录；Cognitive injection=off 且没有 options.skillSelection 的 API 回归中，第二个兼容 Skill 被实际选中并执行。隔离运行 `sdar-verify-16943b19-34af-46d4-afc2-eb75f3ab4577`：3 项定向 E2E 通过，清理成功。
- authoring/registry 复用 Domain Schema 明确性规则：16 项 Domain 正反例、25 项注册/编写/临时 Skill/演化单位回归通过。历史已发布定义仍可读取；新注册不接受开放空契约。
- 0181 追加 Task 终态事务中的 Temporary Skill 失效及唯一经验，覆盖 completed/failed/canceled/invalidated/capability_gap、进程丢失、事务回滚和重复处理。`sdar-verify-ed2e56f7-7207-4c0a-b674-ab4fe8146309` 的 temporary-terminal-pg：7 项通过。此前 6e7315bb、ee8baabe 的失败为新增测试的 FK 创建顺序/终态重复写保护不匹配，保留失败记录；保护没有放宽。
- C 已实现只读投影和官方 SDK public RequestHandler 观察器；提交、follow-up、重连共享观察逻辑，按 revision/interaction hash/result hash 检测变化。`sdar-verify-1db206f0-4db5-48f6-9c95-1de3f6aa07b5`：3 项定向 E2E 通过，纯流式完整结果且 Artifact 先于终态，断线重连不取消，清理成功。观察器、选择和交互等 5 文件 39 项单位回归通过。
- A 的 0179/0180 追加迁移已在 `sdar-verify-02a151fe-b77f-4c6c-804c-dcea1c23ca9c` 证明重复 startup/up、node-run 原子关联及引用存在时拒绝 down（3 项 PG 回归通过）。
- 以上是本轮分批行为证据，不是同一冻结源码的完整门禁。B 的迁移降级/相邻完整套件、C 的在线类型及通用补参、三业务模拟和最终完整开发回归尚待完成；F06/F07、X04 及发布证明继续延期。

### C 在线 admission 实施补记（待所属集成回归）

- 0182 新增 configured Task Type 来源/hash；配置通过既有 KnowledgePromotionService 的配置审批分支及同一 PostgreSQL status transition/evaluation 事务激活，不伪造 Episode、模型归纳或回放。精确设备 profile 保留其已治理选择约束。配置重复导入不会重启已撤销类型。
- OnlineTaskTypeIndexSource 复用现有 KnowledgeSearchRepository 的有界全文/向量召回并重新校验精确 active revision，当前配置/激活状态按请求读取。默认 Runtime 装配 Task Understanding。
- 0183 轻量 capability_admission_receipt 使用 Task 现有 awaiting_user_input/queued/failed 状态；缺参不入队、不创建执行绑定。补参进入现有 authority.prepareAcceptance，绑定/queued attempt/回执以同一事务提交；重复或过期补参不重复入队。显式 Capability 元数据绕开通用解析且权限失败直接拒绝。
- acceptance-map 仅检查18项映射与历史证据结构，不再读取历史 passed 为本次行为背书。最终完整门禁和三业务模拟仍待运行。
