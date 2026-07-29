# P12 A2A Integration Contract

## 1. Public Capability Projection

Agent Card / A2A Skill 只允许投影：

- 已启用的公共能力；
- 稳定输入 / 输出；
- 交互需求；
- 安全说明；
- 可用性摘要；
- 不泄露内部实现。

## 2. Artifact 增强说明

可以说明：

```text
supports experience-informed planning
supports validated planning templates
supports policy-governed fast paths
supports interactive confirmation
```

禁止公开：

- Artifact Candidate；
- 内部 Rule；
- Case 内容；
- Model Route；
- Provider；
- Credential；
- 内部 Skill；
- Private Experience；
- Promotion Threshold。

## 3. Formal Task Authority

A2A Task 状态继续由现有正式 Runtime 维护。

Artifact / Gateway 只作为 Evidence：

- selected route；
- confirmation required；
- fallback；
- formal plan ref；
- outcome ref。

## 4. Input-required

必须复用现有 A2A Input-required：

- Missing Parameter；
- Goal Clarification；
- Scope；
- Authorization；
- High-risk Confirmation；
- Planning Confirmation。

不能创建第二种非标准交互状态。

## 5. Artifact 管理操作

默认不通过公共 A2A Skill 暴露 Approve / Activate / Kill Switch。

如存在内部管理 A2A：

- 独立 Agent / Auth；
- RBAC；
- Tenant；
- Audit；
- Expected Version；
- 不进入 Public Card。

## 6. A2A Evidence

允许安全投影：

- route type；
- artifact type；
- reason codes；
- validation class；
- fallback；
- formal status。

不暴露内部 Artifact Definition 或敏感 Lineage。

## 7. TCK

不得破坏现有 A2A MUST TCK。

新增字段必须：

- 扩展兼容；
- 可忽略；
- Schema；
- Test；
- Version。
