# Codex Goal Prompt：执行 SDAR v1.3 P14 可选扩展包

## 配置

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Mode: Goal
Package: P14 Optional Extension
Extension Goal: X01
```

## 唯一目标

为已经完成受控发布的 SDAR v1.3 建立发布后运行观察、事故响应、回滚演练、成本控制、漂移审查和持续改进机制。

## 开始前必须读取

1. 本任务包全部 Markdown；
2. P13 Final Release Handoff；
3. P13 Release Candidate Report；
4. 实际 Release / Deployment 记录；
5. Rollout / Rollback Plan；
6. Feature Flag / Kill Switch；
7. SLO / Capacity Baseline；
8. Security / Tenant / Credential 规则；
9. Runtime / Gateway / Artifact / Model Route 监控；
10. Incident / Alert / On-call 约定；
11. 当前运行环境和授权边界。

## 强制执行顺序

```text
Release Authorization Check
→ Production Baseline Freeze
→ Monitoring Inventory
→ SLO / Error Budget
→ Alert Policy
→ Runtime / Artifact Watch
→ Security / Tenant Watch
→ Cost / Capacity Watch
→ Incident Runbook
→ Kill Switch / Rollback Drill
→ Recovery Drill
→ Drift / Revalidation Review
→ Feedback Quality Review
→ Operations Review
→ Improvement Backlog
→ Independent Operations Review
→ Commit / Push / Draft PR
```

## 必须实现或交付

- Post-release Baseline；
- Deployment Manifest；
- SLO Dashboard Contract；
- Error Budget；
- Alert Matrix；
- Incident Severity；
- On-call / Escalation Runbook；
- Artifact / Gateway / Rule / Template / Case / Model Route Monitoring；
- Active Pointer / Kill Switch Monitoring；
- Queue / Outbox / Cache Monitoring；
- Provider / Model Readiness Monitoring；
- Token / Cost Monitoring；
- Security / Tenant / Credential Alert；
- Drift / Revalidation Review；
- Feedback Attribution Audit；
- Rollback / Kill Switch Drill；
- Redis / Worker / PostgreSQL Recovery Drill；
- Weekly Operations Review；
- Monthly Governance Review；
- Improvement Backlog；
- Next-version Recommendation。

## 禁止行为

- 未经授权修改生产；
- 自动执行生产回滚；
- 自动开启 Feature Flag；
- 自动关闭 Kill Switch；
- 自动批准 / 激活 Artifact；
- 自动修改 Rule / Template / Model Route；
- 自动 Merge / Tag / Deploy；
- 将告警阈值当业务策略；
- 将 Dashboard 当业务权威；
- 将 P14 计入原14个正式包；
- 创建 G23；
- 重新解释 P13 失败项。

## 最终状态

只允许：

```text
POST_RELEASE_OPERATIONS_READY
POST_RELEASE_OPERATIONS_BLOCKED
```
