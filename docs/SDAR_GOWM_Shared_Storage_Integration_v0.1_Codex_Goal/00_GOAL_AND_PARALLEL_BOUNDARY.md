# D00 — Goal 与并行开发边界

## 目标

仅修改 `zhouwen-giser/skill-driven-agent-runtime`，让 UGV 场景使用的 SDAR 正常运行路径直接读写 GOWM PostgreSQL 中固定共享的 `ugv_sdar` Schema。任务、Goal/Plan关联、Workflow、节点执行、输入目标、MCP调用及回执不再存入另一份待导出业务数据库。

```text
真实SDAR请求入口
→ 明确deviceId及服务绑定
→ agent_task / 初始Admission
→ Goal / Plan / Workflow / Node Run
→ 结构化任务目标与精确目标修订
→ 现有MCP协议调用
→ MCP Invocation / Remote Task Binding
→ GOWM统一读取面回读
```

所有UGV共享同一 `ugv_sdar`。设备归属由 `device_id` 表达，进程、Worker或服务地址变化不改变业务身份。不得按设备/进程创建业务库、Schema、storeId；不得增加Task影子表、导出器、CDC、轮询复制或双写链。

本包的 v0.1 是SDAR接入任务版本，不要求改变项目根版本。

## 并行实施分工

|工作线|修改仓库|运行时允许写入|负责关联|
|SDAR（本任务）|skill-driven-agent-runtime|`ugv_sdar`；`gowm_task`中SDAR拥有的目标及使用关系|Task→Plan→Node Run→Invocation→Remote Task；验证后填写canonical MCP关联|
|SMPP（并行任务）|sdar-mcp-provider-platform|`ugv_smpp`；SMPP/Provider拥有的目标和`gowm_execution`关系|MCP Task→Provider Execution→Dispatch→Mission|
|GOWM（已完成存储）|本任务不修改|设备登记、共享Schema安装、合同和统一查询面|提供公共设备身份、约束及只读关联视图|

SDAR不得在运行时INSERT/UPDATE/DELETE `ugv_smpp`，不得写 `gowm_execution` Mission记录，不得代写SMPP的MCP任务或Provider派发。`ugv_smpp`仅允许为了明确canonical关联及已有证据读取进行只读访问，不能借数据库绕过MCP创建/查询/取消协议。

单任务中不得同时修改GOWM或SMPP。SDAR测试通过当前合同的MCP协议桩独立进行，不要求SMPP开发分支已经完成或合并。两条分支完成后再进行可选真实互操作。

## 开发阶段取舍

复用现有结构、既有确认/取消/幂等/恢复机制，优先把正常应用路径和数据库事务跑通。不得新增审批流程、默认人工确认层、生产安全体系、HA资格、性能门禁、长期多版本兼容或严格Replay。

保留当前development defaults和原有业务确认策略；本任务不以存储接入为理由重新收紧开发流程，也不绕过已有物理副作用限制。测试使用无害协议桩，不执行真实设备动作。

不做旧数据迁移，不切换用户正在运行的实例，不删除旧数据库，不改GOWM设备主档或采集器行为，不改WSGS/SACS/GDPS，不新增设备Skill和覆盖分析。

## 完成层级

- `SDAR_GOWM_SHARED_STORAGE_SOURCE_READY`：全部源码与离线/单元/合同回归完成，真实数据库或正常SDAR路径验证仍未运行。
- `SDAR_GOWM_SHARED_STORAGE_INTEGRATION_DEV_READY`：上述检查及真实GOWM已安装PostgreSQL、双设备SDAR正常执行路径、协议桩回执与GOWM回读全部通过。
- `SDAR_GOWM_SHARED_STORAGE_INCOMPLETE`：必需实现未完成，或已执行的必需测试存在失败。不能用SOURCE_READY掩盖失败。
- `SDAR_SMPP_GOWM_SHARED_STORAGE_INTEROP_VERIFIED`：可选；实际已适配SMPP参与的互操作通过。不是本任务前置或DEV_READY条件。

真实数据库+协议桩只证明SDAR消费者与共享存储集成，不证明真实SMPP、UGV、遥测回流或物理任务完成。Push/Draft PR是交付动作，不替代功能证据；无远程写权限则保留本地提交并说明，不伪造PR。
