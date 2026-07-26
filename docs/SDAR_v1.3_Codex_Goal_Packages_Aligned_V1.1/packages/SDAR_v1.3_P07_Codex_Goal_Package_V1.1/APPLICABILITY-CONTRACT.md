# P07 Applicability Contract

## 1. Hard Gates

按顺序检查：

```text
status
tenant / authorization
feature flag / kill switch
dependency snapshot
required condition
forbidden condition
required parameter
capability
skill candidate
provider readiness
safety policy
OOD / uncertainty
```

任何硬失败都不能由 Match Score 覆盖。

## 2. Condition

### Required

缺失：

```text
fallback / require_confirmation
```

### Forbidden

命中：

```text
deny / fallback
```

由 Artifact Risk 和 Policy 决定。

### Optional

只影响排序、解释或适配，不授予执行权。

## 3. Dependency Snapshot

检查：

- Capability Catalog Hash；
- Policy Version；
- Task Type Version；
- Schema Version；
- Compiler Version；
- Required Skill Version（若 Artifact 明确冻结）；
- Promotion / Validation Version。

失配：

```text
fallback
+
revalidation signal
```

P07 不直接修改 Artifact Status，只发送 Trigger。

## 4. Capability

流程：

```text
Required Capability
→ Internal Runtime Capability Query
→ Current Skill Candidate
→ Current Provider Readiness
```

禁止：

- Public Card 替代内部 Runtime Availability；
- Validation Score 替代 Skill；
- Historical Success 替代 Readiness。

## 5. Policy

Safety Policy 输出：

```text
allow
deny
require_confirmation
```

Safety Policy 覆盖 Business Ranking。

## 6. OOD

至少识别：

- 未见 Environment；
- 未见 Device Class；
- 新 Schema；
- 新 Entity Type；
- 未覆盖 Constraint；
- 置信度不足；
- 多候选矛盾；
- 高风险未知参数。

OOD 默认：

```text
fallback / require_confirmation
```

不得自动使用最近似 Artifact。

## 7. Disposition

### eligible

所有硬门禁通过，参数可信。

### requires_adaptation

低风险参数或局部差异需要后续 P08 适配。

### fallback

使用 v1.2.3 Cognitive Runtime。

### require_confirmation

需要用户或操作员确认。

### deny

Policy 或 Forbidden Condition 明确拒绝。
