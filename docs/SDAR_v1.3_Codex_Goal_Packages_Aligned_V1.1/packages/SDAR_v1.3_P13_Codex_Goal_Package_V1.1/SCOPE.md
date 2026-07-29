# P13 Scope

## 允许修改

```text
security hardening
architecture guards
migration / upgrade scripts
verification scripts
test fixtures
capacity / chaos tooling
operations / rollout scripts
feature flag / kill switch hardening
protocol compatibility fixes
API / Console / A2A defects
documentation / reports
release metadata
```

按仓库实际路径映射：

```text
packages/**
apps/**
infra/**
protocol/**
scripts/**
tests/**
docs/**
reports/**
package.json（仅必要脚本）
```

## 修改要求

每项产品代码修改必须：

- 对应已失败 Gate；
- 有最小测试；
- 不新增未规划 Feature；
- 记录 Source Package；
- 记录 Authority 影响；
- 记录 Rollback。

## 禁止修改

- P00～P12 Goal 边界；
- 14 包顺序；
- 正式 Authority 设计；
- 既有 Acceptance 的安全含义；
- 通过删除测试解决失败；
- 通过 Mock 替代真实 Integration；
- 通过禁用功能掩盖数据损坏；
- 直接改历史 Migration；
- 修改已发布 Source Pin；
- 将 Candidate 当 Active；
- 绕过审批。

## 数据边界

P13 不使用生产 PII、Credential 或真实设备。

## 发布边界

只生成 Release Candidate，不执行生产发布。
