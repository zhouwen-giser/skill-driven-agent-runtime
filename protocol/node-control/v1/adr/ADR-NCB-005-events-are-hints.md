# ADR-NCB-005：Node Events 只作为 Hint

## Decision

消费者必须重读资源，不使用事件直接构建权威状态。

## Consequence

该决策属于协议冻结项，改变时必须提升 Major Contract Version。
