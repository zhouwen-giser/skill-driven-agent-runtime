# Codex Goal 执行策略

## 1. 自主执行与停止条件

冻结决策不得反复请求确认。仅以下情况允许停止整个 Master Goal：

- 无法读取或写入唯一目标仓库；
- 最新主干不包含最低祖先，且无法确定正确 v1.2.2 基线；
- 当前仓库事实与冻结 MUST 存在逻辑矛盾，无法通过兼容映射实现；
- 权限、安全或外部基础设施使所有剩余 Goals 都不可执行；
- 用户显式停止。

局部阻断处理：

1. 创建 Blocker Report；
2. 更新 ExecPlan、sync-state 和 Draft PR；
3. 标记受影响 Goal；
4. 继续全部不受影响 Goal；
5. 不自行改变冻结架构或降低验收标准。

## 2. 分支、提交与 PR

- 从最新 `origin/main` 创建功能分支；
- 不直接提交 main；
- 不 force-push；
- 已推送提交不得 amend；
- 每个 Goal 至少一个独立、有意义的提交；
- 优先按 Goal/子能力拆分提交，不把 Schema、Runtime、Console、Promotion 全塞入一个提交；
- G00 后创建 Draft PR；每个 Goal 更新 PR Body；
- G17 全绿后可标记 Ready for Review，但不 Merge、不 Tag。

建议提交类型：

```text
chore(v1.2.3):
refactor(v1.2.3):
feat(v1.2.3):
test(v1.2.3):
docs(v1.2.3):
```

## 3. Goal 完成规则

每个 Goal 同时具备：

```text
Implementation
Tests
Documentation
Evidence
Meaningful commit
Push
ExecPlan/sync-state update
```

以下不算完成：

- 只写文档、接口或 TODO；
- 只做 Happy Path；
- 只跑 Unit；
- 用 Mock 冒充真实 PostgreSQL/Redis/HTTP 行为；
- 用 Shadow 冒充正式结果；
- 删除或弱化失败测试；
- 将 MUST 标记 deferred 而没有明确外部阻断。

## 4. 测试优先

对 Bug、Invariant、并发、迁移、权限和安全边界，优先先写失败测试或可复现实验，再修改实现。无法先写测试时，在 Completion Report 解释原因。

## 5. ExecPlan 与同步状态

持续维护：

```text
Progress
Decisions
Surprises & Discoveries
Validation Evidence
Changed Files
Source Intake
Open Blockers
Branch/HEAD/Main SHA
Commits/Push/PR
Next Step
```

每个 Goal 完成后更新 `reports/goal/sync-state.json` 和阶段报告。

## 6. 架构边界

- LangGraph.js 是唯一 Workflow Runtime；
- PostgreSQL 是业务事实和知识权威；
- Redis/BullMQ 可丢失、可重建；
- Model Runtime 不拥有业务状态；
- MemoryService 只保存 Active Knowledge 搜索投影；
- Candidate 不进入正式 Planner；
- LLM 只生成结构化候选，确定性代码执行校验和状态提交；
- Goal Lock 内禁止 Model、MCP 和网络 Queue 调用；
- 所有副作用保持 v1.2.2 Policy/Confirmation/No Replay；
- 不引入完整 Python Sidecar 或文件型知识权威。

## 7. 开源复用

- 先读取 `SOURCE-REUSE-POLICY.md` 和 source lock；
- 直接移植代码前创建 Source Intake Report；
- Gemini CLI 只允许小型独立 TypeScript Port；
- AutoSkill 在许可证确认前只允许算法参考；
- 其他 Python 项目全部 clean-room TypeScript 重写；
- 网络搜索只用于官方文档、锁定 commit、许可证和依赖验证；
- 不因参考项目而新增第二 Runtime。

## 8. 验证

先从当前 `package.json` 发现真实命令。最低完整验证：

```text
pnpm install --frozen-lockfile
pnpm verify
```

新增 v1.2.3 验证必须整合进现有 `pnpm verify`，并保留可单独运行的子命令。

## 9. 环境与数据

- 只使用一次性开发/测试数据库；
- reset 命令校验环境和数据库名；
- 不触碰生产数据和外部持久环境；
- Replay 禁止真实设备/MCP 副作用；
- 临时容器和 Worker 完成后停止；
- 不泄露凭据、原始 Provider Header 或非必要 PII。
