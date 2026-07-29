# Codex Goal Prompt：执行 SDAR v1.3 P13

你正在执行 SDAR v1.3 十四个正式任务包中的最终任务包 P13。

## 配置

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Mode: Goal
Package: P13
Repository: zhouwen-giser/skill-driven-agent-runtime
```

## 唯一目标

验证并加固 P00～P12 的完整实现，证明 SDAR v1.3 在架构、权威、安全、容量、恢复、升级、协议、管理面和发布治理方面达到可审查的 Release Candidate 状态，并完成十四包最终偏移审计。

## 开始前必须读取

1. 本任务包全部 Markdown；
2. P00～P12 Completion Report 与 Handoff；
3. P00～P12 Commit / PR / Evidence；
4. 当前 AGENTS.md；
5. 当前 Architecture / ADR / ExecPlan；
6. package.json 与全量验证脚本；
7. 全部 Migration；
8. P01～P12 Domain / Runtime / Management 代码；
9. Security / Auth / Tenant / Credential / Redaction；
10. OpenAPI / Console / A2A / SSE；
11. Feature Flag / Kill Switch / Rollout；
12. SBOM / License / Sources Lock；
13. 当前 PROJECT_STATUS / sync-state；
14. 14 包原始拆分矩阵。

## 强制执行顺序

```text
Baseline Freeze
→ P00-P12 Handoff Integrity
→ Architecture Inventory
→ Authority Audit
→ Cross-package Drift Audit
→ Migration / Upgrade
→ Full Verify
→ Security / Privacy
→ Tenant / Authorization
→ Protocol / API / Console
→ Capacity / Performance
→ Chaos / Recovery
→ Kill Switch / Rollback Drill
→ Reproducibility / SBOM / License
→ Rollout / Canary
→ Known Limitations
→ Release Candidate Decision
→ Independent Reviews
→ Fix Blocking / Major
→ Re-run Gates
→ Commit / Push / Draft PR
→ Final Release Handoff
```

## 必须完成

- 执行时最新 `origin/main` 基线冻结；
- P00～P12 Commit 祖先核验；
- 所有 Handoff Schema / Version 核验；
- Architecture Layer / Dependency 核验；
- Goal / Plan / Workflow / Outcome 权威核验；
- Artifact Candidate / Active / Runtime 权威核验；
- PostgreSQL / Redis / Queue 权威核验；
- Duplicate Authority Scan；
- 14 包 Scope / Boundary / Dependency 偏移核验；
- Fresh Database；
- Upgrade from v1.2.3 Final；
- Rollback / Reapply；
- Rogue Migration Rejection；
- Full Verify；
- Full Unit / Contract / Integration / E2E；
- A2A MUST TCK；
- OpenAPI；
- Console E2E；
- Security；
- Tenant / RBAC；
- Credential / Secret；
- PII / Deletion；
- Capacity；
- Performance；
- Backpressure；
- Chaos；
- Redis Flush；
- Worker Restart；
- PostgreSQL Restart；
- Network / Provider Degradation；
- Kill Switch；
- Artifact Rollback；
- Cognitive Fallback；
- SBOM / License / Sources；
- Reproducible Build；
- Rollout / Canary / Rollback；
- Release Candidate Report；
- Final Consistency Report。

## 禁止行为

- 因门禁失败而删除或降低测试；
- 将未运行写成通过；
- 在 P13 引入新产品范围；
- 用 Feature Flag 隐藏不可恢复的数据错误；
- 自动 Merge；
- 自动 Tag；
- 自动 Production Deploy；
- 自动开启全 Tenant；
- 自动关闭 Kill Switch；
- 复用旧 Approval 绕过 Revalidation；
- 将 Redis / Cache 当业务权威；
- 将 Console / A2A 投影当正式状态；
- 将 Fallback Outcome 计作 Fast Path Outcome；
- 将模型自评当正式 Outcome；
- 用当前状态代替历史迁移 / Replay 证据。

## 最终结论

只允许：

```text
RELEASE_CANDIDATE_READY
RELEASE_CANDIDATE_BLOCKED
```

不得创造“基本通过”“大致可用”等模糊状态。

## 发布授权

即使结论为 `RELEASE_CANDIDATE_READY`：

- 只创建或更新 Draft PR；
- 不 Merge；
- 不创建 Git Tag；
- 不创建正式 Release；
- 不执行生产部署；

除非用户在任务执行时另行明确授权。
