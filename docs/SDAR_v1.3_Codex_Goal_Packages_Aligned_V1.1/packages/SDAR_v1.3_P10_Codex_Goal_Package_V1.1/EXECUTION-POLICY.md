# P10 Execution Policy

## 模型

```text
GPT-5.6 Sol Medium
```

一个主执行 Agent。独立只读 Review 使用新会话。

## 编排原则

Gateway 只做：

- 输入冻结；
- 权威端口调用；
- Deadline 分配；
- 决策组合；
- Fallback；
- Evidence；
- Feedback。

Gateway 不做：

- Artifact 匹配算法；
- Rule 解释；
- Template 生成；
- Plan Validator；
- Skill Selection；
- Workflow 执行；
- Outcome 判断。

## 权威顺序

```text
Auth / Tenant / Authorization
→ Kill Switch / Feature Flag
→ Safety Policy
→ P07 Retrieval / Applicability
→ P09 Rule Runtime
→ P08 Template Runtime
→ Cognitive Fallback
→ Existing Formal Authority
```

## Deny 与 Fallback

以下返回 `deny`，不能转 Cognitive Fallback 后继续执行：

- Authorization missing；
- Policy deny；
- Forbidden safety condition；
- Cross-tenant；
- Critical kill switch；
- Explicit user prohibition。

以下可以 Fallback：

- No artifact match；
- Ambiguous match；
- OOD；
- Timeout before formal commit；
- Artifact stale；
- Dependency mismatch；
- Rule no-match；
- Template adaptation failure；
- Fast path degraded。

## Confirmation

以下返回正式 `require_confirmation`：

- P07 confirmation；
- P09 confirmation；
- P08 confirmation；
- Policy confirmation；
- Goal / Scope ambiguity；
- High-risk parameter；
- Human gate。

Gateway 不自行确认。

## Deadline

Deadline 必须：

- 从请求继承；
- 分配阶段预算；
- 传播给 P07/P09/P08；
- 在正式 Handoff 前检查；
- 到期后取消未提交工作；
- 禁止到期后后台提交正式 Plan。

## Fallback 诚实性

若 Fast Path 失败并 Fallback，必须保存：

- Fast Path Failure；
- Reason；
- Duration；
- Selected Fallback；
- Formal Result Ref。

不得把 Fallback Success 计为 Fast Path Success。

## Feature Flag

至少：

```text
SDAR_V13_FAST_GATEWAY_ENABLED
SDAR_V13_RULE_ENABLED
SDAR_V13_TEMPLATE_ENABLED
FAST_GATEWAY_SHADOW_ONLY
SDAR_V13_TENANT_ALLOWLIST
```

默认上线策略必须由发布治理决定，不在任务包中假设全量开启。

## Git

建议至少：

```text
feat(v1.3): orchestrate compiled artifact fast paths
feat(v1.3): capture artifact runtime feedback
docs(v1.3): record P10 evidence
```

不 Merge，不 Tag。
