# 可直接粘贴给 `/goal` 的项目总目标

```text
完成 Skill-Driven Agent Runtime V1.0 的全部设计、实现、测试、文档和本地可运行交付，直到 source/Agent通用模板Server需求规格说明书_V1.0.docx、docs/01_REQUIREMENTS_BASELINE.md、docs/17_TRACEABILITY_MATRIX.md 中的全部 P0 功能需求、非功能需求和验收场景都有可复现证据，并且仓库的 lint、format check、typecheck、unit、integration、contract、e2e、build 和本地 smoke test 全部通过。

工作方式：
1. 首先完整阅读 AGENTS.md、PLANS.md、PROJECT_STATUS.md、docs/、execplans/、schemas/、examples/ 和 source/需求规格说明书；为复杂工作持续维护 ExecPlan，不得仅依赖对话记忆。
2. 按 EP-00 到 EP-07 的依赖顺序推进，但可在互不冲突的工作树中并行研究。每个阶段必须形成可运行增量、测试证据、ADR 和状态更新，再进入下一阶段。
3. 以 LangGraph.js 作为唯一 Workflow Runtime；使用官方 A2A JavaScript SDK 和官方 MCP TypeScript SDK，通过自研 Adapter 隔离协议类型。A2A 首版目标协议为 1.0.1；因为 JavaScript SDK 的 1.0 支持可能处于 beta，先完成兼容性 Spike、锁定精确版本/commit，并建立协议契约测试。
4. 自研并保持领域权威：Goal Runtime、Skill Runtime、Skill Graph、Workflow DSL、DSL Validator、LangGraph Compiler、Result Processor、Goal Evaluation Loop、Memory、Evaluation、Skill Evolution。不得将 Mastra、VoltAgent、ADK、BeeAI、Microsoft Agent Framework 或 Dify 的 Runtime 嵌入核心执行链。
5. 对八个参考开源项目按 docs/03_OPEN_SOURCE_REUSE_STRATEGY.md 和 third_party/sources.lock.yaml 处理：LangGraph.js 可直接依赖；Mastra、VoltAgent、OpenHands、Dify、Google ADK、BeeAI、Microsoft Agent Framework主要用于源码研究和设计借鉴。任何代码复制、移植或新生产依赖必须先提交 OSS Intake、许可证核查和 ADR。禁止复制 Dify 代码；禁止使用 Mastra 的 ee/ 目录或 OpenHands 的非 MIT 商业仓库。
6. LLM 只输出受 JSON Schema 约束的 Workflow DSL，不得生成并动态执行 TypeScript/JavaScript。DSL 只能使用白名单节点和受限表达式。编译器必须拒绝未知节点、无界循环、非法引用、Schema 不匹配和未注册工具。
7. 计划—执行必须分离。除 Skill 明确自动确认外，MCP 调用前必须等待计划确认；Goal 变更后所有旧 Workflow、中间结果和确认全部失效，新计划始终重新确认。外层通过执行结果和目标评估决定是否生成下一版 Workflow，不在执行中修改当前图。
8. 对副作用工具、无认证、anonymous 共享记忆、执行中任务故障不可恢复等已接受风险，按需求实现并在代码、控制台和文档中明确告警；不得悄悄增加与需求冲突的权限模型，也不得删除风险记录。
9. 默认使用 PostgreSQL + pgvector 保存核心数据和长期记忆，Redis 保存运行态、缓存和 BullMQ 队列。执行中任务在进程或 Redis 故障后不恢复、不自动重试；排队任务可继续调度。同一 context_id 严格串行。
10. 后端为 Node.js/TypeScript 单进程模块化单体；A2A、管理 API、队列 Worker 和 LangGraph 执行在同一进程。管理控制台使用 React + TypeScript + React Flow 风格的自研实现，不复制 Dify UI 源码。
11. 每次修改都运行最小相关测试；每个 EP 结束运行完整门禁。不得通过跳过测试、降低断言、删除需求、扩大 any、关闭 TypeScript strict、吞掉异常或用静态假数据冒充功能来获得绿色结果。
12. 所有关键模型、Prompt、工具调用、Workflow、事件、评估和演化记录必须可追踪，但不得存储或展示模型私有思维链；只保存输入、原始可展示响应、结构化决策摘要、工具参数/结果、Token、耗时和错误。
13. 每完成一个可验收增量，更新 PROJECT_STATUS.md、docs/17_TRACEABILITY_MATRIX.md、ADR、测试报告和 CHANGELOG。提交信息使用 Conventional Commits；保持工作树可构建。
14. 如果某项无法在当前环境真实验证，使用 Mock 或协议测试完成最大可验证范围，并在最终报告中明确区分“真实验证、模拟验证、未验证”，不得声称已完成。

完成证据：
- 所有需求在追踪矩阵中映射到实现文件、测试文件和测试命令；状态为已验证。
- 端到端验收场景 AC 全部通过并生成机器可读与人工可读报告。
- 可通过一条文档化命令启动 PostgreSQL、Redis、Mock MCP、Server 和 Console，并运行示例 A2A Client 完成基础任务、计划确认、流式状态、Skill 组合、暂停恢复、Goal Patch、重规划、记忆检索、评估和 Skill 模拟验证。
- Agent Card 可动态反映启用 Skill；A2A 1.0.1 主要协议行为有契约测试。
- `pnpm verify`（或仓库定义的等价统一命令）全部通过。
- README、架构文档、API 文档、运维说明、风险说明、第三方许可证清单和发布检查表完整。

约束保持：
- 不替换 LangGraph.js，不引入第二个执行 Runtime。
- 不直接在核心领域层使用外部框架对象。
- 不修改需求基线；发现冲突时记录 ADR/阻塞，不擅自删减。
- 不向外发送、发布、部署或操作真实生产系统。
- 只在仓库和允许的隔离环境内工作；遵守许可证和凭据安全要求。

迭代策略：每轮根据失败测试、运行日志、追踪矩阵缺口和当前 ExecPlan 选择下一个最高价值动作；优先修复根因和完成垂直闭环，不以增加更多抽象代替可运行结果。如果预算到达、依赖不可用或不存在可辩护路径，停止并输出已完成范围、命令与证据、未完成需求、根因、已尝试方案以及解除阻塞所需的最小输入。
```
