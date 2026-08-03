# 02. 范围、权威与非目标

## v1.4 实施范围

```text
Node Control Backend
↔ SDAR Runtime
↔ SMPP Registry / MCP Provider
→ Telemetry Export
```

## 冻结权威

- Runtime PostgreSQL：Goal、Plan、Task、Workflow、Skill Attempt、Outcome、Recovery、Artifact 执行权威。
- Node Control PostgreSQL：Node Profile、Configuration、LLM、SMPP Source、MCP Binding、Capability Definition、Exposure、Management Operation、Audit。
- Runtime：Capability Readiness 运行权威。
- Capability Definition：节点业务承诺唯一权威。
- Skill：内部执行实现。
- Plan Template Artifact：可复用流程模板唯一权威。
- A2A Exposure：Capability 对外投影。
- TaskCapabilityBinding：Task 接受时生成的不可变合同。
- SMPP Registry：Provider 候选目录。
- MCP `server/discover + tools/list`：Operation Catalog 权威。
- Provider Availability：资源当前可执行性权威。
- Telemetry Platform：历史采集、投影、查询；不在本 Goal 内实施。

## 明确不做

- 正式控制台前端；
- 组织树和跨节点目标委托；
- 分层自治组织网络控制平面；
- 遥测数据查询、评价、对账和 Dashboard；
- ClickHouse 查询代理；
- 全局监督平台；
- 全域交互中枢；
- 第二套 Workflow Runtime；
- 第二套 Plan/Workflow Template；
- 旧实验数据库兼容；
- 从遥测事实反向修改 Runtime 权威。

## 受控范围差异

原完整设计中的 Console IA 延期到二期组织控制平面。
本 v1.4 只交付 Headless Backend 和未来组织平台调用 Profile。
该范围由接口协议冻结包中的 ADR-NCB-001/002 固化。
