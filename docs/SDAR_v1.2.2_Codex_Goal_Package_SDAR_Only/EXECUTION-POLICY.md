# Codex Goal 执行策略

## 1. 自主执行

冻结决策不得反复请求确认。

仅以下情况允许停止并报告阻断：

- SDAR 主干不包含最低祖先；
- 必需的 Provider Skeleton 资产未提供，阻断 G07；
- 必需的 Provider Runtime Candidate 未提供，阻断 G10；
- 冻结 Provider Skeleton 与 V0.5.2 合同直接矛盾；
- 当前 SDAR 架构使某个 MUST 逻辑上无法实现；
- 权限或外部基础设施阻止验证。

阻断处理：

1. 记录文件、符号、命令、错误；
2. 标记受影响 Goal；
3. 继续所有不受影响 Goal；
4. 更新 ExecPlan；
5. 不自行修改冻结合同；
6. 不修改 Provider 项目。

## 2. Goal 完成规则

每个 Goal 必须同时完成：

```text
Implementation
Tests
Documentation
Evidence
Meaningful commit
```

以下不算完成：

- 只写接口；
- 只写文档；
- 只做 Happy Path；
- 只跑 Unit；
- 留 TODO；
- 用 Mock 代替最终真实 Interop；
- 删除失败测试；
- 把未完成 MUST 标成 deferred。

## 3. 提交规则

每个 Goal 至少一个独立提交。

建议提交类型：

```text
refactor(v1.2.2):
feat(v1.2.2):
test(v1.2.2):
docs(v1.2.2):
```

不得将 Baseline Schema、终态权威、Business Events Wire 和 Console 全部塞进一个提交。

## 4. ExecPlan

持续维护：

```text
Progress
Decisions
Surprises & Discoveries
Validation Evidence
External Dependency Status
Provider Defects
Changed Files
Open Blockers
```

## 5. 架构边界

- LangGraph.js 是唯一 Workflow Runtime；
- PostgreSQL 是运行权威；
- Redis/BullMQ 可重建；
- MCP SDK/Wire Type 不进入 Domain/Application；
- LLM 输出必须经过确定性 Validator；
- 所有副作用经过 Policy/Confirmation；
- Goal 状态在 Goal Serial Gate/CAS 下提交；
- Provider 项目只读。

## 6. 验证

从当前仓库 `package.json` 发现真实命令。

最低完整验证：

```text
pnpm install --frozen-lockfile
pnpm verify
```

若脚本变化，运行当前等价命令并记录差异。

## 7. 环境

- 只使用一次性开发/测试数据库；
- reset 命令必须校验环境和数据库名；
- 不触碰外部 Provider 持久数据库；
- 真实 Interop 只通过公开接口；
- 完成后停止临时容器；
- 不泄露凭据。
