# ADR-NCB-007：TaskCapabilityBinding 不可变

## Decision

Task 接受时冻结，后续实现变化通过 Attempt/Plan Revision 追加。

## Consequence

该决策属于协议冻结项，改变时必须提升 Major Contract Version。
