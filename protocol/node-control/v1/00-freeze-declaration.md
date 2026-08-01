# 00. 协议冻结声明

## 已冻结

- 资源身份、路径和操作语义；
- Revision、ETag、If-Match 和 Idempotency-Key；
- Draft → Validate → Publish → Apply → Ack → Active/LKG；
- Desired/Observed/Convergence 模型；
- Capability—Skill—Plan Template—A2A—Task 关系；
- Task 接受时不可变 Capability Binding；
- Runtime 内部 Apply/Ack 协议；
- Node Event Envelope 和事件目录；
- Telemetry Export 配置与本地 Delivery State；
- RBAC Scope、SecretRef、Problem Details 和错误码；
- 未来组织控制平面的可消费 API Profile。

## 禁止重新引入

- 浏览器直接调用 Runtime 内部接口；
- Node Control API 直接映射 Runtime 数据库表；
- 前端字段，例如 button、badge、screen、pageLayout；
- SDAR 代理 Telemetry Query API；
- `/telemetry/query`、任务遥测时间线、评价或对账接口；
- ClickHouse 表名和数仓字段进入 Node Control API；
- A2A AgentSkill 直接等同内部 Skill；
- Skill.capabilities 自由字符串重新成为正式能力权威；
- Control Backend 停机导致 Runtime 停止；
- Publish 被解释为 Runtime 已应用。

## 实施期只允许校准

v1.3 最终源码 SHA、Migration Head 和现有 Management API 适配方法可在实施 P00 校准，但不得改变本包的协议语义。
