# ADR-NCB-003：外部与内部 API 分离

## Decision

`/api/v1` 是稳定 Node API；`/internal/v1` 只供 Runtime Control 使用。

## Consequence

该决策属于协议冻结项，改变时必须提升 Major Contract Version。
