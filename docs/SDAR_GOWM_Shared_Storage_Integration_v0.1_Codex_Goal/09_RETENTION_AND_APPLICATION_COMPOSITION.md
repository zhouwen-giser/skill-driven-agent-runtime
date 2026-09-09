# D09 — 历史保留与正常应用装配

## 不把共享存储做成测试专用

必须在 `apps/server/src/runtime.ts` 和正常 `start:server` 入口装配：
- 共享存储配置和验证器。
- 指向ugv_sdar的实际Pool / Repository。
- 设备上下文解析及Task创建传递。
- 目标关系写入。
- Remote Task canonical补齐和scoped poll/continuation/cancel。
- A2A投影、事件、恢复与清理。

不能新建一个只供测试直接INSERT数据的小Server代替正常SDAR。模型推理可由测试依赖注入确定性模型桩，但必须进入相同Task/Plan/Workflow/调用/回执业务代码。

## Shared与旧模式

当前存储模式按明确配置选择。保留其他既有开发部署入口以降低无关回归，但共享模式不能容忍某Repository仍指向public业务表。

不新增shadow DB，不读新库失败后读取旧库。不得把所有服务Pool包括Node Control管理库无差别替换成GOWM业务Pool。

启动日志可以说明模式、固定Schema和负责设备数量，不能打印密码/完整连接串。业务库验证与MCP可用性分别呈现：GOWM存储准备好不代表SMPP在线，MCP unavailable也不应阻止离线存储适配测试。

## 历史保留

盘点retention、cleanup、terminal projection、temporary skill及evidence依赖删除链。共享模式不能因Task终态、MCP句柄过期就删除用于Task→Plan→Node Run→MCP追溯的核心业务行、目标绑定和必要关联证据。

允许按现有规则释放claim/lease、修剪非业务缓存，但不能将Admission、Invocation、Continuation最后有效状态或已派发目标视为可丢弃缓存。

本阶段不建归档平台或冷热分层。对会删除核心关系的路径在共享模式中停止物理清理或采用既有不破坏历史的语义，并在retention-matrix说明；不通过新触发器/修改GOWM权限偷偷阻止删除。

## 停机与恢复

停止顺序明确：停止新接纳/claim，停止poller/consumer，完成或回滚当前事务，关闭MCP连接和Pool。重启后读取同一Task和Binding恢复，不创建重复Plan或新MCP任务来替代未确认记录。

当前Task确认策略、development preauthorization、Deadline、预算和取消行为保持原样，不为了数据库接入加一层新的确认，也不关闭原有保护。
