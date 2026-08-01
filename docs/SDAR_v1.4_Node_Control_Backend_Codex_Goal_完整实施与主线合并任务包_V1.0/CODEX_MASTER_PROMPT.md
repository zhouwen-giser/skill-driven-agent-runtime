# Codex Goal 主指令：完成 SDAR v1.4 并合并到 main

你是 `zhouwen-giser/skill-driven-agent-runtime` 的 v1.4 实施负责人。
这是一个需要持续执行、可恢复、可审计的 Goal，不是只输出计划或建议。

## 1. 目标

在执行开始时获取远程 `main` 的最新进度，以其精确 HEAD 作为唯一基线，
创建并推送：

```text
feature/v1.4-node-control-backend
```

然后严格按 P00～P14 实现 SDAR v1.4。每个阶段必须：

1. 完成代码和文档；
2. 运行阶段门禁；
3. 生成真实证据报告；
4. 创建至少一个实施提交和一个证据提交；
5. 推送到 GitHub；
6. 更新可恢复 Goal 状态；
7. 才能进入下一阶段。

P14 完成后：

1. 再次同步最新 `origin/main`；
2. 运行完整发布门禁；
3. 创建面向 `main` 的 Pull Request；
4. 等待并检查 GitHub Checks；
5. 没有失败、未解决冲突或必需审批阻断时，使用 Merge Commit 合并；
6. 验证 v1.4 分支最终 SHA 已成为 `origin/main` 祖先。

## 2. 首先完整阅读

按顺序阅读任务包：

```text
SOURCE_LOCK.json
TASK.json
00_MASTER_GOAL.md
01_LATEST_MAIN_BASELINE_AND_BRANCH.md
02_SCOPE_AUTHORITY_AND_NON_GOALS.md
03_ARCHITECTURE_AND_PACKAGE_MAP.md
04_DATABASE_AND_MIGRATION_EXECPLAN.md
05_CONTRACT_IMPLEMENTATION_POLICY.md
06_GIT_GITHUB_PHASE_DELIVERY_POLICY.md
07_MAIN_SYNC_CONFLICT_AND_RESUME_POLICY.md
08_TEST_EVIDENCE_AND_RELEASE_POLICY.md
09_FINAL_PR_AND_MERGE_POLICY.md
TASK_INDEX.md
phases/P00.md ... phases/P14.md
```

然后校验并解压：

```text
references/SDAR_v1.4_单节点控制平面_完整设计冻结基线_V1.0.zip
references/SDAR_v1.4_Node_Control_Backend_接口协议冻结基线_V1.0.zip
```

冻结设计与接口协议是最高产品/合同权威；任务包负责执行顺序和 GitHub 交付。

## 3. GitHub 授权与禁止事项

用户明确授权：

- `git fetch` 最新 main；
- 创建和推送 v1.4 分支；
- 每阶段提交与推送；
- 最终创建 PR；
- Checks 通过时执行 Merge Commit。

严格禁止：

- 直接 Commit/Push 到 `main`；
- `git push --force` 或 `--force-with-lease`；
- 对已推送 v1.4 分支执行 Rebase；
- `git reset --hard` 删除未知用户工作；
- 自动合并旧 v1.3 Feature Branch；
- 绕过 Branch Protection、Required Review 或失败的 Checks；
- 自动创建 Tag、Release 或生产部署；
- 为追求通过而删测试、降级断言、隐藏失败或伪造证据。

## 4. 开始时必须执行

1. 检查工作树干净；不干净则停止，不得 Stash 或删除用户内容。
2. 检查 `gh --version` 和 `gh auth status`。
3. 确认仓库是 `zhouwen-giser/skill-driven-agent-runtime`。
4. 读取远程默认分支并确认是 `main`。
5. 执行：

```bash
git fetch --prune --tags origin
git switch main
git pull --ff-only origin main
```

6. 记录精确：

```text
main commit SHA
main tree SHA
commit time
package version
migration head
migration ledger hash
management OpenAPI hash
operation inventory hash
A2A baseline hash
Frozen Interface Registry hash
pnpm-lock hash
source lock hash
repository settings
```

7. 在未改动 main 上执行：

```bash
pnpm install --frozen-lockfile
pnpm verify
```

8. 确认 v1.3 P00～P13 所需基础已在 main。禁止从未合并 v1.3 分支补基线。
9. 创建或恢复 `feature/v1.4-node-control-backend`。

## 5. 红色基线处理

若最新 main 自身验证失败，或缺少 v1.4 依赖的 v1.3 权威：

- 仍可从该 main 创建 v1.4 分支；
- 只创建 Blocker、Baseline Report 和 Goal State；
- Commit 并 Push；
- 状态写为 `BLOCKED_RED_MAIN_BASELINE` 或 `BLOCKED_MAIN_NOT_V13_READY`；
- 不开始生产功能开发；
- 不擅自合并其他 Feature Branch。

## 6. 分支恢复

若远程分支已存在，只允许在以下条件下恢复：

- `reports/v1.4-node-control/goal-state.json` 存在；
- `goalId` 等于 `SDAR-V1.4-NODE-CONTROL-BACKEND`；
- 远程分支可以 Fast-forward 拉取；
- 没有未解释的历史重写；
- 已完成阶段的 Evidence 与 Commit SHA 一致。

否则创建 Blocker 并停止，不能覆盖已有分支。

## 7. 每阶段统一流程

每个 PXX：

```text
fetch main
→ 判断 main 是否前进
→ 必要时 merge origin/main 到 v1.4 分支
→ 更新 ExecPlan
→ 实施
→ 阶段测试
→ 实施 Commit
→ 生成 Evidence
→ Evidence Commit
→ Push
→ 核对远程 SHA
→ 更新 Goal State
```

实施提交建议：

```text
feat(v1.4-pXX): ...
```

证据提交：

```text
docs(v1.4-pXX): record completion evidence
```

主线同步提交：

```text
chore(v1.4): merge main <short-sha> before PXX
```

## 8. 质量真实性

- Pass、Fail、Skip 必须分别记录。
- 未运行不得写为通过。
- Mock 不得证明真实 PostgreSQL、Redis、HTTP、A2A 或进程恢复。
- 测试失败必须保留失败尝试和修复证据。
- 最终 `pnpm verify` 必须在 Clean Worktree 的精确候选 SHA 上执行。

## 9. 最终 PR 与合并

P14 通过后：

- PR 标题：`feat(v1.4): add single-node control backend`
- Base：`main`
- Head：`feature/v1.4-node-control-backend`
- 合并方法：Merge Commit，保留 P00～P14 提交历史。
- 当前仓库可能未启用 Auto-merge；不要假设可用。
- Required Review 阻断时将状态设为 `AWAITING_PROTECTED_REVIEW`，不得绕过。
- Checks 失败时修复、提交、推送并重新等待。
- 可合并后执行显式 Merge。
- 合并后验证分支候选 SHA 已进入最新 `origin/main`。

## 10. 最终回复

仅报告：

- Goal 状态；
- Baseline main SHA；
- v1.4 Branch 和最终 SHA；
- P00～P14 状态；
- 测试摘要；
- PR URL 和编号；
- Merge Commit SHA，或保护规则阻断；
- 未验证事项。

不要以口头说明替代 GitHub Commit、Push、PR 和 Merge 证据。
