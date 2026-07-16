# 已知假设、冲突与待验证项

## 必须在 EP-00 验证

1. A2A 规范锁定 1.0.1，但官方 JavaScript SDK 稳定渠道可能仍实现 0.3，1.0 支持可能来自 `@next`。必须锁定版本并做契约测试。
2. A2A SDK 内部 Task Store 是否可由本项目 PostgreSQL Repository 适配，不能让 SDK Store 成为第二系统记录。
3. MCP TypeScript SDK 的具体包名、版本和 Streamable HTTP 取消能力。
4. LangGraph.js 对动态 State Schema、并行汇合、子图、事件和 Redis Checkpoint 的可用边界。
5. Node 版本、ORM、Web 框架和前端版本的共同兼容性。

## 设计解释

- “MCP Tool 失败由 LLM 动态决策”不代表 LLM 可突破系统预算、Tool 权限或副作用事实。系统先生成允许动作集合，LLM 在集合内选择。
- “保存完整模型调用”不包括保存私有思维链。保存 Prompt、上下文、模型可见原始响应、结构化决策、Token 和耗时。
- “Skill 自动发布”只适用于系统从多次经验归纳且全部模拟用例通过的版本；A2A 用户请求创建的 Skill 仍是草案。
- “Redis 保存运行 Checkpoint”与“故障不恢复”并不冲突：Checkpoint 用于暂停/恢复和正常运行，不作为崩溃恢复承诺。
- FR-WF-009 的“费用预算”在 V1 中解释为系统配置的 LLM/MCP/Skill/子工作流调用计费单位，而不是未经配置便猜测供应商货币账单。模型 Token 仍独立审计；未来如增加 Provider 价格元数据，必须通过同一预算计量端口接入并保留执行时价格快照。
- 外层控制器达到 `maxReplans` 后采用 fail-closed 终止策略：保留最后实例和评估证据，将控制标记为 `replan_budget_exhausted`，并将 Goal 标记为 `unachievable`，避免保留一个没有剩余可执行路径的 active Goal。
- v1.0.6 的 `commitCanceled` 适用于已拥有一个 active WorkflowControl 的单 Task 运行终态；显式 Goal-wide cancellation 仍由既有 PostgreSQL 多 Task/Plan/Instance cascade transaction 管理，并在该事务内为每个 active Control 创建 canceled Runtime Terminal Outcome。两条路径不得交叉单写同一 active Control；如未来合并 application Port，必须新增 ADR 说明批量锁顺序、幂等键和部分 Control 不存在时的语义。
- v1.0.7 将 A2A message metadata 的 `structured_input` 作为正式顶层 Skill 结构化输入的规范键，并兼容既有客户端可能发送的 `sdar_structured_input`；两者同时出现时规范键优先。请求文本、Goal Contract、同 Context 已处理数据、补充输入和长期 Memory 依次降级，长期 Memory 只能作为历史证据，不能声明设备当前状态。
- v1.0.7 的正式 Skill 重规划固定使用 WorkflowControl 已保存的结构化输入；仅新的持久化 Task input response 或 Goal Patch 触发新的输入解析记录。子 Skill 继续在各自调用边界独立校验，父级解析结果不授予子级输入权限。
- v1.0.7-bug-fixed 将 Goal Patch 后的输入解析解释为 Patch 提交前置条件：若新 Goal Contract 无法为同一正式 Skill 产生 schema-valid 输入，Patch 不改变 Goal/Task/Plan，调用方需先澄清请求再重试 Patch。这一 fail-closed 语义避免 `newPlanId` 指向不存在计划的部分提交。
- v1.0.8 的 0061 历史回填优先使用 Goal Patch 的 before/after snapshot，其次使用当前 Goal 行。若早期记录已失去全部可恢复 Goal 证据，则保存带明确 legacy 描述的兼容快照，仅用于历史可读性；任何新规划、替代、确认继承或执行都必须提交并匹配当前完整 Contract，不能把该兼容快照当作新权限。
- v1.0.8-bug-fixed 保留未注册 Goal 的管理端 standalone selection/planning 能力，用于低层验证与预注册编排；一旦相同 `goalId` 已在 PostgreSQL 注册，该 Goal 必须仍为 active 且六字段完全一致。终态或内容漂移均在 embedding/model 调用前拒绝。
- v1.0.9 将任务包的 `composable` 语义映射到仓库既有 `composition` 枚举，不新增同义关系。初始组合只沿 root 出站的 `parent_child`、`depends_on`、`input_output_match`、`composition`、`capability_coverage` 遍历，深度上限 8、相关 Skill 上限 32；`alternative` 仍仅用于失败后替代。0062 前的历史计划保持可读/可执行兼容，但没有组合快照的旧行不得被当作新规划授权来源。

Codex 发现新的缺口时在此追加，并通过 ADR 或阻塞报告处理。

## EP-00 执行发现

- 2026-07-11：当前目录不包含 Git 元数据，无法生成 Conventional Commit 证据，也无法基于 Git 恢复文件字节版本。首次建立格式门禁时，宽范围 Prettier 对部分 Markdown/JSON 基线执行了内容等价的排版重写；未改变需求文本或状态。格式脚本现已限制为代码与配置文件，后续不得格式化 `docs/`、`schemas/`、`examples/`、`source/`。如获得仓库原始 Git 历史，应恢复这些基线文件的原始排版后再重放明确的状态/缺口编辑。
- 2026-07-11：官方 `a2aproject/a2a-tck` commit `5996b79f9cefa6fc390980e383e358a66fb9e49e` 的顶层 `LICENSE` 和 README 声明 Apache-2.0，但 `pyproject.toml` metadata 声明 MIT。仓库提供精确 `uv.lock`，所以依赖可复现；许可证元数据冲突必须在正式纳入分发或 vendoring 前由上游修正或通过 ADR 明确解释。EP-01 可将其作为临时外部测试工具运行，但不得复制或作为生产依赖。
- 2026-07-11（2026-07-13 更新）：上述 TCK commit 内嵌 specification branch 为 `v1.0.0`。规范声明 patch 版本不参与 wire negotiation，因此 Agent Card/请求仍使用 `1.0`。当前确定性 TCK SUT 已补齐 input-required/history fixture，官方 HTTP+JSON/MUST 结果为 74 passed、161 scoped skips、0 failed/errors、100%；同时 production endpoint 合约直接覆盖 v1.0.1 的 `application/a2a+json`，并保留 TCK 所需 `application/json`。精确规范/SDK/TCK pin 与证据边界见 ADR-069；不声称 JSON-RPC/gRPC 或稳定 SDK。
- 2026-07-13：原始 SRS 的 A2A 版本描述内部冲突：多数正文、FR-A2A-002 与部署表写 1.0.0，但术语表和 NFR-COMP-001 验收文字指定 1.0.1。`docs/01_REQUIREMENTS_BASELINE.md` 已一致采用更严格的 1.0.1，ADR-069 将其作为规范基线，未修改原始 SRS。
- 2026-07-11（2026-07-13 最终更新）：Docker Desktop 的早期容器变更挂起已恢复。当前 `pnpm verify`、`pnpm demo:local` 和 `pnpm demo:acceptance` 均真实启动 PostgreSQL/pgvector 与 Redis；integration、41 场景 E2E、基础设施 smoke 和 Server/Console smoke 通过。早期不可用记录保留在历史报告中，但不再是当前阻塞。
