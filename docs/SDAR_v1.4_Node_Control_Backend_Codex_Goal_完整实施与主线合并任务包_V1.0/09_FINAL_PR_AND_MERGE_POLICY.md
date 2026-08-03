# 09. 最终 PR 与主线合并策略

## 1. 最终同步

P14 完成后重新执行：

```bash
git fetch origin main
git merge --no-ff origin/main
```

完成冲突处理和完整 `pnpm verify`，工作树必须干净。

## 2. Release Candidate

生成：

```text
reports/v1.4-node-control/release/release-report.md
reports/v1.4-node-control/release/release-report.json
reports/v1.4-node-control/release/pr-body.md
```

Release Report 包括：

- Baseline main SHA；
- Latest merged main SHA；
- Candidate SHA；
- P00～P14 Commit；
- Migration；
- API/Schema Hash；
- Test Summary；
- Security/Recovery；
- Known Limitations；
- No Console/No Telemetry Query 证明；
- Rollback；
- Failed Attempts。

## 3. 创建 PR

```bash
gh pr create   --base main   --head feature/v1.4-node-control-backend   --title "feat(v1.4): add single-node control backend"   --body-file reports/v1.4-node-control/release/pr-body.md
```

不得创建 Draft：只有 P14 完整通过后才创建最终 PR。

## 4. 合并条件

- PR Base/Head 正确；
- Branch SHA 等于 Candidate SHA；
- Mergeable；
- 无冲突；
- 所有 Required Checks 通过；
- 无 Changes Requested；
- 所有 Required Review 满足；
- 最新 main 已同步；
- Release Report 已在 PR 中。

## 5. 合并

仓库支持时：

```bash
gh pr merge <PR_NUMBER> --merge --delete-branch
```

使用 Merge Commit 保留阶段历史。

Auto-merge 当前可能关闭，不得依赖。
若 Branch Protection 要求用户审批：

```text
status = AWAITING_PROTECTED_REVIEW
```

保持 PR Open，不能 Admin Override。

## 6. 合并验证

```bash
git fetch origin main
git merge-base --is-ancestor "$CANDIDATE_SHA" origin/main
```

记录：

- PR URL；
- PR Number；
- Merge Commit SHA；
- mergedAt；
- origin/main SHA；
- branch deletion status。

不创建 Tag 或 Release。
