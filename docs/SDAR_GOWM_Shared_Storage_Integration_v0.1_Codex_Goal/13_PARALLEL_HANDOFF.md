# D13 — 给SMPP并行工作线的固定边界

本文件是接线分工，不新增协议版本，不要求SMPP因本包改变已经交付的数据库合同。

## 固定输入

```text
GOWM database：由部署指定
SDAR Schema：ugv_sdar
SMPP Schema：ugv_smpp
公共：gowm_device / gowm_task / gowm_execution / gowm_business_v1
共同身份：真实device_id + 稳定smpp_service_key + 历史binding_id
```

## 写入责任

- SDAR写agent_task、workflow、Invocation、Remote Binding，以及SDAR拥有的target_binding。
- SMPP写provider_task、UGV execution/dispatch和MCP/Provider target_binding、Mission link。
- 双方读取同一设备目录；不互相补写对方不存在的业务根记录。
- SDAR只在自己的Remote Binding上补canonical_mcp_task_id，SMPP只在自己的Execution/Link上补已确认的MCP关联。

## 没有全链完成时的可用状态

```text
SDAR Task已入库、尚无MCP调用 → NO_REMOTE_TASK
协议回执已存、canonical尚未解析 → 本地RESOLUTION_PENDING；公共视图可为PROVIDER_PENDING
canonical已解析、Provider/Mission尚未产生 → PROVIDER_PENDING或MISSION_UNRESOLVED
```

这些是关系可见性，不是新的SDAR任务终态。没有Mission不自动失败，也不能自动成功。

## 设备切换与ID

smpp_service_key是逻辑来源，不是worker进程ID。server_id是SDAR配置别名，不是数据库Schema。remote_task_id保留协议返回值，canonical是经证据与共享父记录验证的内部MCP身份。

历史Task继续使用创建时的device/binding/MCP authority snapshot；新任务使用当前绑定。对同一设备重复执行产生新Task/Run身份，而不是覆盖旧任务关系。

## 独立测试与联调

各自在不同的隔离测试database中装相同共享Schema；不能在同一测试库并发运行互相reset的测试。每个测试database内部必须有两台设备共用同一套业务表。

SDAR协议桩身份必须可与GOWM现有provider_task约束对账。可选联调再把桩换成SMPP真实服务，应用代码不变。

跨仓阻塞只记录，不用本任务改另一个仓库。两条分支都通过各自DEV_READY后，再执行真正SDAR↔SMPP互操作；用户原先要求的Mission/遥测完整闭环仍是后续阶段。
