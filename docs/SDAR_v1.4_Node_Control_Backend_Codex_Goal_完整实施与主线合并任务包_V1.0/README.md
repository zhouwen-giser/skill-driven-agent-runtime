# SDAR v1.4 Node Control Backend — Codex Goal 完整实施与主线合并任务包 V1.0

本任务包用于让 Codex Goal 模式在
`zhouwen-giser/skill-driven-agent-runtime` 中完成 SDAR v1.4。

## 最终目标

```text
远程最新 origin/main
→ 建立精确 v1.4 基线
→ 创建 feature/v1.4-node-control-backend
→ P00～P14 顺序实施
→ 每阶段 Commit + Push
→ 最终完整门禁
→ 创建 main Pull Request
→ Checks 通过后使用 Merge Commit 合并
→ 验证分支最终提交已进入 origin/main
```

## 使用

把本 ZIP 解压到 Codex 可访问目录，在 SDAR 仓库根目录启动 Goal 模式，
将 `CODEX_MASTER_PROMPT.md` 的完整内容交给 Codex。

Codex 必须能使用：

- `git`
- `gh`
- GitHub Push 权限
- Node.js / pnpm
- Docker / Compose（仓库现有验证需要时）
- PostgreSQL / Redis 测试环境

## 冻结输入

- 完整设计冻结包 SHA-256：`1d0c72a9a54baf88ddd0a2d8a585b33e0c1ba056694c16b37cf19e6b18dfb4cb`
- 后台接口协议冻结包 SHA-256：`367797107847c210bb4240d5525ad0cfa625f8f65856f1eddc7c61bff2523d1c`

## 合并授权边界

用户已授权：

- 创建 v1.4 开发分支；
- 每阶段提交并推送；
- 完成后创建 PR；
- 所有门禁通过且仓库规则允许时执行 Merge Commit。

未授权：

- 直接写入 `main`；
- Force Push；
- 重写已推送历史；
- 绕过分支保护或必需审批；
- 自动创建 Tag、GitHub Release 或生产部署。
