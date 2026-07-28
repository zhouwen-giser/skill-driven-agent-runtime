# Execution Policy

## 基线

使用执行时最新、包含当前 P03/P04 实现的分支后继提交。已审查 SHA 只用于定位，不作为硬绑定。

## P00～P02

P00～P02 为冻结基线。仅消费 P02 Authority/Handoff，不重新实施。

## 版本

受影响合同升级到 V1.2。必须同步更新：

- Domain 常量；
- JSON Schema；
- Schema Hash；
- Shared Registry；
- P03/P04 Handoff；
- P05 Consumer Lock；
- P13 Audit。

禁止用字段 Alias 假装 V1.1 已对齐。

## Review

三次独立只读 Review。Reviewer 不修改代码。

## Git

建议独立修复提交：

```text
fix(v1.3-p04r): align activity identity and process mining
fix(v1.3-p04r): close compiler semantics and validation
fix(v1.3-p04r): connect candidate generation runtime
docs(v1.3-p04r): align registry and handoffs
```
