# 01. 最新 main 基线与开发分支

## 1. 不允许预设 SHA

本任务包不将生成时观察到的提交作为实施基线。Codex 执行开始时必须重新获取远程 main。

## 2. 仓库检查

```bash
set -euo pipefail

test -z "$(git status --porcelain=v1)"
gh --version
gh auth status

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
test "$REPO" = "zhouwen-giser/skill-driven-agent-runtime"

DEFAULT_BRANCH="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)"
test "$DEFAULT_BRANCH" = "main"

git remote get-url origin
git fetch --prune --tags origin
git switch main
git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

## 3. 基线记录

写入：

```text
reports/v1.4-node-control/baseline/main-baseline.md
reports/v1.4-node-control/baseline/main-baseline.json
```

机器记录至少包含：

```json
{
  "repository": "...",
  "fetchedAt": "...",
  "mainSha": "...",
  "mainTreeSha": "...",
  "mainCommitTime": "...",
  "packageVersion": "...",
  "migrationHead": "...",
  "managementOpenapiSha256": "...",
  "operationInventorySha256": "...",
  "a2aBaselineSha256": "...",
  "frozenInterfaceRegistrySha256": "...",
  "pnpmLockSha256": "...",
  "verify": {
    "command": "pnpm verify",
    "status": "passed|failed",
    "startedAt": "...",
    "finishedAt": "...",
    "exitCode": 0
  }
}
```

## 4. 分支创建

远程分支不存在：

```bash
git switch -c feature/v1.4-node-control-backend origin/main
git push -u origin feature/v1.4-node-control-backend
```

存在时按照恢复规则读取 Goal State，不得覆盖。

## 5. v1.3 依赖门禁

main 必须提供或等价提供：

- PostgreSQL 运行权威；
- LangGraph 唯一 Workflow Runtime；
- Skill Version；
- Plan Template Artifact；
- Artifact P02/P06 权威；
- A2A Projection；
- MCP Provider/Remote Task；
- Transactional Outbox；
- Management OpenAPI；
- v1.3 P00～P13 最终报告/等价证据。

缺失则阻断，不能从旧 Feature Branch 自动搬运。
