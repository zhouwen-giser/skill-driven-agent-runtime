# ADR-V14-GOAL-001：v1.4 采用 Headless Node Control Backend

## 决策

v1.4 实施范围不包含正式控制台前端和遥测数据观测。

## 原因

正式控制台前端将在二期集成到分层自治组织网络控制平面；
遥测数据观测也由该二期平台直接消费独立遥测平台 Query API。

## v1.4 保留

- Node Control Backend；
- Runtime Control；
- Node Events；
- Telemetry Export Configuration/Status；
- Organization-facing Node API Profile。

## 明确排除

- Console View Model；
- 页面路由；
- Dashboard；
- Telemetry Query Proxy；
- ClickHouse Query；
- Task Timeline/Evaluation/Reconciliation UI。

接口协议冻结包 ADR-NCB-001 和 ADR-NCB-002 为本决策的合同依据。
