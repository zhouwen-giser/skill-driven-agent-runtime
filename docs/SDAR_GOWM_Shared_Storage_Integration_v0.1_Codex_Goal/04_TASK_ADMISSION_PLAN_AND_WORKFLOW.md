# D04 — Task、初始接纳、计划和Workflow

## 真实入口覆盖

盘点TaskService、初始Admission、Interactive/User Goal Planning、计划准备、SkillGoal调度、A2A projection以及正常server composition。核心Repository入口通常位于：

```text
apps/server/src/runtime.ts
packages/persistence-postgres/src/repositories.ts
packages/persistence-postgres/src/task-capability-*.ts（按实际文件定位）
packages/persistence-postgres/src/remote-task-admission-intent-store.ts
packages/persistence-postgres/src/workflow-continuation-repository.ts
packages/a2a-adapter/src/postgres-task-store.ts
```

文件清单不是替代源码审查；初始Admission的真实实现位置必须查明，不凭路径名称猜。

## agent_task

插入、所有UPSERT、DTO/Row映射和序列化保留device三字段。旧payload不含字段时只能在明确legacy模式走旧分支，共享设备模式缺少归属应在写库前给出业务错误。

不要给新Task复制旧Task的非零revision；继续经现有命令上下文创建/修改Task，遵守数据库原生revision与command trigger，不用SET session_replication_role或关闭触发器让测试通过。

查询/列表/patch/输入/确认/取消/终态提交按Task身份+授权设备范围。不能仅限制列表，不限制按ID读取和更新。

## 初始Admission幂等

GOWM最终结构：

```text
内部主键：admission_id UUID
设备唯一：(device_id, sdar_service_key, idempotency_key) WHERE device_id IS NOT NULL
非设备唯一：(idempotency_key) WHERE device_id IS NULL
```

适配INSERT冲突目标及对应partial-index谓词，SELECT/UPDATE/claim同时使用完整设备范围；不能仍把caller key当主键。保持原有参数冲突判断、接纳状态、claim token和重入行为。

同设备+同服务+相同key+相同输入：返回原Task。
不同设备相同key：独立Task。
相同scope+key但不同目标/参数：按现有幂等冲突拒绝，不能覆盖旧任务。
非设备幂等独立，不与设备任务冲突。

初始接纳、Task创建与已有capability/admission证据关联保持原子性。远端MCP admission是另一条流程，不能只改远端而遗漏初始接纳。

## Plan / Workflow

设备执行计划保存 `workflow_plan.device_id / gowm_task_id`，实例保存device，事件和plan_attempt按对应父实例/plan传递设备。计划先于Task产生的共享候选仍保留其已有语义；采用为设备执行计划时生成可归属本Task的执行计划记录，不把共享候选改写成另一设备计划。

完整保留definition_json的nodes、edges、条件、并行、循环、subworkflow/skill_call。不要为本任务创建第二套简化Workflow引擎或shadow step表。

Task→Plan回指与Plan→Task归属存在创建顺序时，先按实际合同创建Task，再创建执行Plan，再经合法Task更新设置plan_id；不靠禁用FK或复制修订绕开。

## Node / Node Run

保留 `workflow_instance_id / workflow_node_id / workflow_node_run_id / parent_workflow_instance_id / parent_skill_call_id / skill_attempt_id` 等原生身份。Retry、循环或子Workflow的同名node不是同一执行。

普通workflow_node_event可能只有instance+sequence+node，公共读取用NATIVE_EVENT；异步MCP节点已知准确run使用REMOTE_NODE_RUN。禁止按nodeId把事件与所有Remote Binding做笛卡尔JOIN。计划存在但未执行的节点不能显示成功。

## 外部Task投影

`external_task_projection`是SDAR原有A2A/协议业务投影，不是本任务新增同步副本。更新实际device字段和父Task校验，保留原协议字段、完整结果及同一Task状态语义，不删除原投影功能。
