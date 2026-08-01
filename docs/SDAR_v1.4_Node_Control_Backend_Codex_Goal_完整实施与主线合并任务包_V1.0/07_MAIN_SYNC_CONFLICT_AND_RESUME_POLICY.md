# 07. 主线同步、冲突与恢复

## 每阶段开始前

```bash
git fetch origin main
```

若 `origin/main` 已前进：

1. 记录新 main SHA；
2. 检查变化与本阶段重叠；
3. 使用 Merge Commit 同步，禁止 Rebase：

```bash
git merge --no-ff origin/main
```

4. 解决冲突；
5. 运行至少受影响门禁和 `pnpm verify:architecture`；
6. 提交/推送；
7. 更新 Main Sync Report。

建议提交：

```text
chore(v1.4): merge main <short-sha> before PXX
```

## 冲突阻断

以下冲突不得自行猜测：

- Authority 改变；
- Migration Ledger 重写；
- Frozen API 资源/动作改变；
- A2A/MCP Protocol 破坏性变化；
- 现有 P02/P06 Artifact 权威变化；
- LangGraph 唯一 Runtime 变化。

创建 ADR/Blocker，Commit/Push 后停止。

## Goal State

持续维护：

```text
reports/v1.4-node-control/goal-state.json
```

每阶段 Evidence Commit 后更新：

```json
{
  "goalId": "SDAR-V1.4-NODE-CONTROL-BACKEND",
  "status": "ACTIVE",
  "baselineMainSha": "...",
  "branch": "feature/v1.4-node-control-backend",
  "lastCompletedPhase": "P05",
  "remoteHeadSha": "...",
  "mainSyncSha": "...",
  "phases": {}
}
```

## 恢复

新 Goal 会话必须：

- Fetch；
- Switch 远程分支；
- Pull --ff-only；
- 验证 Goal State；
- 重新执行最后阶段关键 Gate；
- 从第一个未完成阶段继续。

不得因会话丢失重做已完成阶段或覆盖远程历史。
