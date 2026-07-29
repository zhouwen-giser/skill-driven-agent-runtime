# P13 Dependency Contract

## 前置状态

```text
P00 = READY_FULL
P01～P12 = completed and merged
origin/main contains all package commits
```

## P00～P12 必需输入

每包至少提供：

- Commit SHA；
- Handoff JSON；
- Completion Report；
- Review Report；
- Test Evidence；
- Migration / Port / Event / Version；
- Known Limitations；
- Open Blockers。

## 23 原子 Goal

P13 必须核验：

```text
G00
G01
G02 G03 G04
G05 G06
G07 G08
G09 G10
G11 G12
G13 G14
G15
G16
G17 G18
G19 G20
G21
G22
```

## 外部依赖

必须冻结：

- Node / pnpm；
- PostgreSQL / pgvector；
- Redis / BullMQ；
- A2A SDK；
- MCP SDK；
- LangGraph；
- Model Provider；
- Container Image；
- OS / Runtime 约束。

## 输出

P13 输出给 Release / Operations：

- exact release candidate SHA；
- verification status；
- migration / upgrade path；
- rollout / canary；
- rollback；
- kill switch；
- SLO；
- capacity；
- security；
- known limitations；
- post-release monitoring；
- authorization required actions。
