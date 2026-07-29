# Codex Goal Prompt：执行 SDAR v1.3 P12

你正在执行 SDAR v1.3 十四个正式任务包中的 P12。

## 配置

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Mode: Goal
Package: P12
Repository: zhouwen-giser/skill-driven-agent-runtime
```

## 唯一目标

把 P01～P11 的 Artifact 编译、治理、运行和反馈能力，通过现有 Management API、Console、A2A、SSE 和审计体系进行安全、可操作、可解释的集成，同时保持所有领域和运行权威不变。

## 开始前必须读取

1. 本任务包全部 Markdown；
2. P00～P11 Handoff；
3. 当前 Management API / OpenAPI 约定；
4. 当前 Console 架构、路由、权限、Evidence 组件；
5. 当前 A2A Agent Card / Skill / Task / Input-required / SSE；
6. 当前 Operator Identity / RBAC / Tenant；
7. 当前 Audit / Idempotency / Expected Version / CAS；
8. 当前 Redaction / Secret / Credential / PII 规则；
9. P02 / P06 Governance Ports；
10. P07～P11 Runtime Query / Evidence / Feedback Ports；
11. v1.2.2/v1.2.3 正式 Goal / Plan / Task / Outcome / A2A 权威。

## 强制执行顺序

```text
Baseline
→ Handoff Validation
→ Exposure Inventory
→ RBAC / Tenant Contract
→ Management Query API
→ Governance Command API
→ Runtime Evidence API
→ OpenAPI
→ Console Registry / Detail
→ Console Validation / Promotion / Active
→ Console Runtime / Feedback / Cost / Drift
→ A2A Capability Projection
→ A2A Input-required / Confirmation
→ SSE / Event Projection
→ Audit / Redaction / Idempotency
→ Security / Accessibility
→ Tests
→ Evidence
→ Read-only Review
→ Commit / Push / Draft PR
```

## 必须实现

### Management API

- Artifact list / detail；
- Version / diff / lineage；
- Validation / Shadow / Promotion summary；
- Approval / Activation / Revalidation / Deprecation / Rollback / Kill Switch；
- Active query；
- Runtime Match / Applicability / Rule / Template / Gateway；
- Case / Model Route；
- Usage / Outcome / Cost / Drift；
- Audit；
- Pagination / filtering / sorting；
- Expected Version / Idempotency；
- RBAC / Tenant；
- Redaction；
- OpenAPI。

### Console

- Registry；
- Artifact Detail；
- Version Diff；
- Lineage；
- Validation / Replay / Counterexample；
- Shadow；
- Promotion Review；
- Approval / Activation；
- Active / Revalidating / Deprecated；
- Runtime Decision Timeline；
- Match / Rule / Template / Gateway；
- Case / Model Route；
- Usage / Outcome / Cost；
- Drift / Revalidation；
- Kill Switch / Rollback；
- Audit；
- Empty / Loading / Error / Permission 状态；
- Accessibility。

### A2A / SSE

- Public Capability Projection；
- Active Artifact capability summary；
- Artifact-enhanced planning evidence；
- Input-required；
- Confirmation；
- A2A Task / Goal 正式状态保持；
- SSE Gateway / Runtime / Governance evidence；
- 不暴露内部 Skill / Provider / Credential / Candidate；
- Existing A2A TCK 兼容。

## 禁止实现

- 直接写数据库绕过 Service / Repository；
- Console 直接调用数据库；
- 管理 API 绕过 P02/P06 Governance；
- Approval 和 Activation 合并；
- 请求体 actorId 作为可信身份；
- A2A 自动批准 Artifact；
- A2A 把 Candidate 当公开 Skill；
- A2A 暴露内部 Model Route / Credential；
- SSE 改变正式任务状态；
- UI 修改 Runtime 决策规则；
- 自动开启全部 Feature Flag；
- 重新实现 P07～P11；
- Hardening / Release 最终签发。

## 完成后

交付 P13 Handoff，包含完整 API / Console / A2A / Security / Operations 证据。P13 负责最终 Hardening、容量、恢复、发布门禁和一致性总检查。
