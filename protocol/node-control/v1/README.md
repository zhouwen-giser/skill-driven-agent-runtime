# SDAR v1.4 Node Control Backend 接口协议冻结基线 V1.0

## 状态

- 冻结状态：`PROTOCOL_DESIGN_FROZEN_IMPLEMENTATION_PENDING`
- Node Control API：`1.0.0`
- Runtime Control Contract：`1.0.0`
- Node Events Contract：`1.0.0`
- Evidence Export Contract：`1.0.0`
- 冻结日期：2026-07-31
- 目标产品：SDAR v1.4 单节点控制后台
- 前端：不在 v1.4 一期范围
- 遥测数据查询：不在 SDAR 产品范围

## 产品关系

```text
未来组织控制平面 / 运维 CLI
              │
              ▼
       Node Control API
              │
      Node Control Backend
              │ Internal Contract
              ▼
          SDAR Runtime
              │
              └── Evidence Export → 独立 SDAR Evidence Sink
```

## 冻结边界

本基线冻结的是稳定后台协议，不是页面协议：

1. Node Control API：对运维工具和未来组织控制平面公开；
2. Runtime Control Contract：Node Control Backend 与 SDAR Runtime 内部使用；
3. Node Events：节点对未来组织控制平面发布变化提示；
4. Evidence Export：只管理事实出口和本地投递状态。

明确不包含：

- React 页面、页面路由和页面 DTO；
- 遥测数据查询、任务时间线、评价、ProviderOps 对账；
- ClickHouse 查询代理；
- 多节点组织树和全局目标编排；
- 第二套 Runtime、Workflow Engine 或 Task Authority。

## 关键原则

```text
Control Plane 定义期望状态
Runtime 维护运行权威
Evidence Sink 独立观察
Node Events 只提示变化，GET 才是展示依据
```
