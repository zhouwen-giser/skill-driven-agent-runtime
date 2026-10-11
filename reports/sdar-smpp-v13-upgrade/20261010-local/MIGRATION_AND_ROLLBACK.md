# 本地升级的迁移与回滚说明

本次仅完成本地代码和隔离验证。现场数据库、配置和部署均为 NOT_RUN。

## 原生 PostgreSQL

新增 `infra/postgres/migrations/0184_v14_task_business_input_source.up.sql`，仅扩充原生
`task_input_request.source` 检查约束，恢复已有 RemoteTask 输入服务需要的 `remote_task`。
原 clean-slate baseline、0103 和既有迁移不改写。业务投影、完整内容、命令与确认链复用
不可变 `remote_task_observation` 记录；没有新业务数据库或第二套 Task 状态机。

当前完整迁移门禁、实际 PR34 仓储读取器，以及活动旧任务与新投影共存测试见
`M4_VALIDATION.json`、`CASE_RESULTS.json` AC-039/044。旧读取器按精确提交
`52f54a11a40380f7c73bd9da277d640e49bdfbf7` 归档并真正执行；旧 authority 不变且不新增 Tool 调用。

## GOWM

继续使用已选正式合同、原生 Task 归属、受限消费者角色与既有仓储配置。
SDAR 消费者不执行 GOWM DDL，不写 SMPP 私有业务表，也不创建影子状态库。
隔离验证由 owner 的固定提交安装专用数据库后授予消费者既有权限；正式链路运行时
schema 指纹和 SMPP 私有表计数不变。现场选定角色的资格检查仍需现场授权。
本次局部证据不关闭原项目的 auxiliary execution link / temporary Skill 上游缺口。

## 回滚的执行边界

以下是供后续明确授权操作使用的步骤，本次没有对现场执行：

1. 暂停新业务确认与派发；保留现有读取、原 Task 等待和有限只读核对。
2. 对当前实例调用只读 `GET /api/v1/task-business/rollback-preflight`。
   `writeTakeoverAllowed=false` 或任何 `pendingIntentIds` 时，旧版本不得接管写操作。
   prepared、dispatching、accepted、uncertain 均属于需要先处理的未决记录。
3. 依原授权和精确 command/Task/Execution 证据完成只读核对。失去响应、超时或进程退出
   不能成为再次发送的依据；核对耗尽后保留 uncertain，不能伪造 confirmed 或删除记录。
4. 原生 0184 down migration 会在存在保留的 `remote_task` 输入时拒绝运行。
   保留这些输入、命令和确认事实，完成兼容处置前保持该增量约束；不得为执行 down 删除历史。
5. 只有只读预检允许写接管、旧版本兼容读取已证实，且后续操作获得明确授权，才可切换写入口。
   旧版本读取新 namespaced observations 的兼容性不等于其能够处理新增未决业务写命令。
6. GOWM 任何 owner schema 变更均由 owner 的正式流程处理；消费者不执行原生 0184 或替代 DDL。

代码恢复与数据约束恢复是不同步骤。回滚不能撤回已经发出的网络请求，也没有跨 HTTP/设备
exactly-once 保证。保留主密钥的原环境配置和 AES-256-GCM 加密方式，不将密钥写入证据。
