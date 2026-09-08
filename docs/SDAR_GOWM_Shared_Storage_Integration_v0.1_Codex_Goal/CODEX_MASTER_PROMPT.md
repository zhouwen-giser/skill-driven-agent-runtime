# Codex Goal：SDAR接入GOWM共享业务数据库 v0.1

目标仓库：`zhouwen-giser/skill-driven-agent-runtime`
只读上游：`zhouwen-giser/geospatial-operational-world-model`
并行工作线：SMPP共享存储适配，禁止在本任务修改其仓库。
目标分支：`codex/sdar-gowm-shared-storage-integration-v0.1`

## Goal

实际修改SDAR正常业务路径，直接读写GOWM已提供的固定共享 `ugv_sdar`，以 `device_id` 归属数据，保存 Task、Goal/Plan关联、Workflow/Node Run、任务目标图形、MCP Invocation、Remote Task Binding，并在明确证据和父记录可见时补齐canonical MCP身份。

不要只写设计文档，不要只换连接串，不要只做测试专用Writer。

## 基线

开始读AGENTS.md并fetch当前远端。SDAR本包观测main=`cb50da8ec8d160a673852be8bcdfc3bb094f5ce5`；GOWM共享存储观测分支 `codex/gowm-device-shared-business-storage-v0.2` HEAD=`48cebb862e992579b801590385b4373b10422d52`，旧main尚未包含该能力。选择执行时实际包含功能的分支，记录来源，不锁死旧SHA或反复追HEAD。

先阅读GOWM `docs/shared-business-storage-handoff/sdar-handoff.md`、`repository-adaptation-matrix.md`，以及 `ugv_sdar.sql / sdar-hardening.sql / sdar-additional.sql / sdar-derived-ownership.sql / read-model.sql` 的最终内容和安装manifest。不要依据旧每实例建库设计实施。

## 范围

仅改SDAR。GOWM、SMPP、SACS、WSGS、GDPS、Analysis Providers只读。正常SDAR不写ugv_smpp或Mission表，不直接INSERT MCP Task代替调用；MCP创建/查询/取消继续走原协议。

GOWM安装结构，SDAR启动仅verify。禁止自动重放baseline、ALTER上游结构、关闭触发器、按实例建Schema、默认ugv1、导出同步、双写、故障回落旧库。独立Node Control管理库不搬迁。

保留现有Task确认策略、development defaults、Command/Revision/Idempotency及恢复，不增加人工审批、生产安全/HA/发布门禁。不得运行实车命令或新增武器能力。

## 必须落实

1. agent_task在创建时写device_id/gowm_binding_id/sdar_service_key，非设备三者NULL；禁止后改归属。
2. initial_task_admission使用内部admission_id和设备/非设备独立partial唯一键。
3. 设备执行workflow_plan写device_id/gowm_task_id；实例/事件/Invocation继承同设备；共享Goal/Skill/模板不锁成单车。
4. 保留完整Workflow定义、Node Run、循环/重试和子Workflow；Native Event不与所有同node Run笛卡尔JOIN。
5. 目标图形分REQUESTED/PLANNED/DISPATCHED；同事务与原业务记录写入，精确owner key；局部坐标不伪装WGS84。同步MCP无Remote时不伪造Binding。
6. Remote Binding使用设备+smpp_service_key+server_id+remote_task_id；保留原ID/authority，canonical只在真实父记录device/service匹配时解析。
7. 父MCP行晚发布时先NULL，受控补齐；不阻塞原MCP结果处理，不重发原任务，不由SDAR补造父行。
8. 每个claim/poll/cancel/continuation/admission/event/cleanup按实际Task或subscription限定设备。空allowedDeviceIds不是全设备，非设备明确分支。
9. business_event_subscription按最终设备current/generation键；无硬Task FK的Evidence/Projection/Config/Temporary Skill等表也填正确device。
10. 同一个PoolClient完成跨表事务，网络调用在事务之外。保持Task修订与命令触发器。
11. 正常server真实装配；清理策略保留核心任务历史。
12. 默认不要求Docker，也不等待SMPP完成。使用真实GOWM已安装PostgreSQL+真实SDAR正常路径+合规MCP协议桩验证双设备。

## 并行验证

协议桩/测试同伴只能在明确隔离测试库用独立测试角色发布合成MCP父行；生产SDAR角色无ugv_smpp DML。桩测试不冒充真实SMPP。两条开发线使用不同测试库、同一合同，每库内部两设备共用同Schema。

测试必须涵盖父先到/父后到、opaque ID、跨设备同幂等key和远端ID、重启恢复、目标修订/回滚、取消输入、订阅代际、共享Goal以及GOWM只读面回读。

## 顺序

按FULL_CN.md的P0—P7实施；先实现最小正常链，再覆盖全部读写/后台路径。acceptance.json与test-scenarios.json列明验收，不把包内NOT_RUN当测试结果。

使用真实package.json脚本：pnpm typecheck、lint、test、build及受影响architecture/protocol/migrations检查；新增gowm-storage:check、test:gowm-storage:unit/postgres/runtime及smoke --help。避免默认启动Docker或release全量资格。

## 完成口径

- 源码和无环境检查完成、DB/正常路径未运行：`SDAR_GOWM_SHARED_STORAGE_SOURCE_READY`。
- 真DB、双设备正常SDAR路径+MCP桩和回读通过：`SDAR_GOWM_SHARED_STORAGE_INTEGRATION_DEV_READY`。
- 必需实现未完或必需测试失败：`SDAR_GOWM_SHARED_STORAGE_INCOMPLETE`。
- 真实SMPP互操作是可选独立标志，不阻碍并行开发。

发现上游真实缺口写最小UPSTREAM_STORAGE_GAP，不改GOWM或规避约束，继续其余工作但不伪造完成。

交付实际代码、配置、离线合同摄取、测试、docs与FINAL_REPORT.md/json，单仓commit和Draft PR。不合并、Tag、Release、部署，不迁移旧数据。没远程权限保留本地提交并如实说明。
