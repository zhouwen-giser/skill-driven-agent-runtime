# 06. Git/GitHub 阶段交付策略

## 用户授权

- 创建 `feature/v1.4-node-control-backend`；
- 每阶段 Commit + Push；
- 最终 PR + Merge Commit。

## 每阶段至少两个提交

### 实施提交

```text
feat(v1.4-pXX): <phase delivery>
```

### 证据提交

```text
docs(v1.4-pXX): record completion evidence
```

Bug 修复可在证据提交前增加：

```text
fix(v1.4-pXX): <root cause>
test(v1.4-pXX): <regression evidence>
```

## Push 证据

阶段报告记录：

- local implementation SHA；
- local evidence SHA；
- remote branch SHA；
- push time；
- changed files；
- commands；
- tests；
- status。

核对：

```bash
git push origin HEAD
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git ls-remote origin "refs/heads/$(git branch --show-current)" | cut -f1)"
test "$LOCAL_SHA" = "$REMOTE_SHA"
```

## 禁止

- 直接 main Commit/Push；
- Force Push；
- Amend 已推送 Commit；
- Rebase 已推送分支；
- `git add -A` 时包含未知无关文件；
- 删除失败报告；
- 用一个最终大提交替代阶段提交。

## Commit 内容

每个 Commit 必须逻辑单一、可审阅、可回滚。
生成物和报告不得包含 Secret、`.env`、数据库数据、WAL、日志或 node_modules。
