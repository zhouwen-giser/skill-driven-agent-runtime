# D06 — MCP调用、canonical关联与并行接口

## 保持调用协议

SDAR创建、查询、输入、取消远端Task仍通过现有MCP客户端和Frozen MCP Tasks合同。GOWM数据库不是远端任务API。

不新增公开MCP字段来强迫SMPP同步修改；需要的device context在内部持久化和当前受支持的MCP绑定/Resource/调用上下文中传播。若已有协议确有表达缺口，记录最小差异，不擅自改变冻结协议。

## Invocation与Remote Binding

`mcp_invocation`保存实际参数、结果、device。Remote Binding必须保存：

```text
device_id
smpp_service_key
server_id（原配置别名，不删除）
remote_task_id（原MCP返回值，不改写）
canonical_mcp_task_id（可空UUID）
agent_task_id
workflow_plan_id / workflow_instance_id
workflow_node_id / workflow_node_run_id
mcp_invocation_id
原有Skill尝试、上下文和Authority快照
```

设备分支冲突键使用最终partial unique index，非设备使用独立nondevice索引。所有getByRemoteTaskId、通知查找、取消、reconcile入口使用完整device+service+server+remote身份；不能先按两个字符串查到一条后假定属于当前设备。

## canonical关联流程

1. 从真实MCP返回保存remote_task_id；必要时canonical仍NULL。
2. 已证明本次调用的Runtime是绑定的smpp_service_key，且协议提供可识别的MCP Task ID时，读取 `ugv_smpp.provider_task`。
3. 同时校验task_id、device_id、smpp_service_key，额外保留实际operation/provider/回执对应关系核对。
4. 父记录已存在且匹配时，在Remote Binding业务事务中调用等价于GOWM resolveRemoteTask的受限更新；仅允许NULL→已验证ID或同ID重放。
5. 父尚未发布：保持NULL和待关联诊断；正常MCP轮询/任务处理照常，不创建假的父Task，不将该情形当远程执行失败。
6. 另一设备、另一服务、不同已确认ID或无来源证据：拒绝关联，保留冲突诊断；不修改已有业务归属。

原生remote_task_id可能不是UUID。不能仅靠UUID可解析就建立关联；没有已证明映射时保持未解析。不得按时间、Task标题、设备名称、参数相似度猜测。

## 延迟补齐

复用现有remote reconciliation/回执处理循环，有限批次重查SDAR自己拥有的待关联Binding。任务已终态但canonical仍NULL，也应有受控补齐入口，不无限poll远端Task，不重做原MCP调用。

这是补一个外部键，不是复制SMPP业务表。库中无父记录时仍为待关联；真实查询错误与不存在区分。保留已有deadline、cancel和lease，不另起同步服务。

## 并行工作线的稳定接点

|接点|本SDAR任务|并行SMPP任务|
|设备与服务|读GOWM设备/历史绑定|读相同登记|
|MCP调用|现有协议发起和消费回执|现有协议接纳并创建任务|
|共享表|仅写ugv_sdar|写ugv_smpp|
|canonical_mcp_task_id|验证后更新自己的Remote Binding|发布真实provider_task供读取|
|Mission|只读已有明确关系用于展示或证据引用|创建/确认Mission与派发关系|
|测试|协议桩，独立SDAR隔离库|模拟设备，独立SMPP隔离库|

不要求两者同时合并。选择同一份GOWM存储合同完成各自测试；只有可选互操作才使用双方完成的分支。

## 状态与证据边界

canonical关联成功、Mission link=LINKED仅证明关系存在，不证明物理目标达成。继续使用现有Provider evidence/终态验证语义；本任务不增强或重写导航成功判定，不读取某条SMPP状态就强行将SDAR Task改completed。
