# SDAR → GOWM 共享业务存储并行接入 v0.1

完整 Codex Goal 任务书 · 2026-09-08

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


---

# D01 — 实际基线与合同摄取

## 本轮读取的来源（2026-09-08）

|仓库|分支|观测提交|
|---|---|---|
|SDAR|main|`cb50da8ec8d160a673852be8bcdfc3bb094f5ce5`|
|GOWM|codex/gowm-device-shared-business-storage-v0.2|`48cebb862e992579b801590385b4373b10422d52`|
|GOWM|main|`dd1b038fa0fa3e3893d7f4c7f815bfe9992b0838`|

GOWM共享存储本次位于功能分支，而不是上述旧main。执行时先读各仓库AGENTS.md并fetch；SDAR从最新已知主线或用户明确相关基线建立 `codex/sdar-gowm-shared-storage-integration-v0.1`。只读GOWM优先选择已包含共享存储的main，否则用该功能分支的当前有效头。不得从旧main误报上游缺失，不根据包内SHA强制回滚，不为了追逐上游新SHA无限重跑。

保护用户未提交修改，不强推、不自动合并、不打Tag、不发布。GOWM/SMPP只读检出和临时构建不应污染其工作区。

## 必须读取的GOWM文件

```text
docs/shared-business-storage-handoff/sdar-handoff.md
docs/shared-business-storage-handoff/smpp-handoff.md
docs/shared-business-storage-handoff/repository-adaptation-matrix.md
docs/shared-business-storage-handoff/data-dictionary.md
docs/shared-business-storage-handoff/connection-examples.env
docs/shared-business-storage-handoff/device-scope-key-inventory.json
database/migrations/078_device_shared_business_storage.sql
database/shared-business-storage/install-manifest.json
database/shared-business-storage/source-inventory.json
database/shared-business-storage/expected-structure.json
database/shared-business-storage/overlays/ugv_sdar.sql
database/shared-business-storage/overlays/sdar-hardening.sql
database/shared-business-storage/overlays/sdar-additional.sql
database/shared-business-storage/overlays/sdar-derived-ownership.sql
database/shared-business-storage/overlays/smpp-additional.sql
database/shared-business-storage/overlays/read-model.sql
packages/integrations/device-business-storage/src/repository.ts
scripts/business-storage/installer.ts
```

路径发生变化时读实际继任文件；不臆造列/方法。最终已安装DDL、全部overlay和约束优先于早期说明。交接中的验证PASS不能替代本任务使用真实SDAR代码验证。

## 已核实的重要差异

1. `agent_task`新增 `device_id / gowm_binding_id / sdar_service_key`，三者同时为空或同时有值。设备任务不允许后补修改归属。
2. `workflow_plan`是设备执行计划投影时保存 `device_id / gowm_task_id`；`goal / user_goal_plan / skill_goal`等共享规划语义不能强行归给一台设备。
3. `initial_task_admission`已改用内部 `admission_id:uuid` 主键；设备幂等是 `(device_id,sdar_service_key,idempotency_key) WHERE device_id IS NOT NULL`，非设备仍有独立partial unique key。
4. `remote_task_binding`设备唯一身份为 `(device_id,smpp_service_key,server_id,remote_task_id)` 的设备partial index；非设备为原server/remote的独立partial index。
5. `canonical_mcp_task_id`可为空；非空时必须指向同device、同smpp_service_key的真实provider_task。不是把remote字符串直接写成UUID。
6. `business_event_subscription` current和generation都增加设备/服务维度；其子表仍由真实subscription_id继承。
7. `external_task_projection`、临时Skill、Evidence来源和Task配置绑定等无硬Task FK的表也新增设备列及父级一致性校验。
8. `workflow_steps`分开返回 `NATIVE_EVENT` 与 `REMOTE_NODE_RUN`，不承诺每条node event都具有可证明的Node Run ID。

## 交付到SDAR仓库的紧凑摄取物

建议 `contracts/gowm-shared-storage/current/`：来源记录、相关表/列/键/触发器摘要、必需迁移family/overlay、必要只读DDL参考、许可证。不是SMPP/GOWM安装副本，不在启动中执行这些DDL；不把1.7MB全量键清单写日志。

生成 `schema-consumption-matrix.json`，逐项覆盖实际入口、插入、更新、冲突处理、查询、claim、恢复、清理、序列和触发器依赖。不能只修改几张根表。

当SDAR当前主线比GOWM捕获的原生baseline更新，比较实际必需差异：能在消费者通过参数/SQL/调用顺序解决的直接做；缺表/缺列/不相容约束的输出最小UPSTREAM_STORAGE_GAP，禁止自行ALTER GOWM或禁用触发器。继续完成其他部分，受影响场景不得PASS。


---

# D02 — 连接、启动与事务

## 配置

建议新增或复用以下清晰配置，最终按当前项目风格实现：

```text
SDAR_STORAGE_MODE=gowm-shared
GOWM_DATABASE_URL=<由部署注入>
SDAR_SERVICE_KEY=<稳定逻辑服务>
SDAR_ALLOWED_DEVICE_IDS=["实际deviceId-A","实际deviceId-B"]
SDAR_DEVICE_ID=<仅单设备专用实例可显式配置；可空>
SDAR_GOWM_CONTRACT_DIR=contracts/gowm-shared-storage/current
```

这些是本任务建议的配置名，不是已存在环境变量。`allowedDeviceIds`解析JSON数组；空集合不等于所有设备。单设备实例可显式绑定一个设备作为请求上下文，多设备入口没有明确设备就返回清晰缺少上下文，不选数组第一项。

保留既有非UGV/非设备使用入口，避免一项改造破坏通用SDAR；共享模式每个进程只有一个业务主库，不双写，故障时不回退public或旧库。旧模式不是新建长期多版本产品。

`GOWM_DATABASE_URL`与现有runtime DB配置冲突时明确报错或清晰配置优先级，禁止一部分Repository仍写旧库。独立Node Control配置库、管理数据库不在本次迁移范围；runtime侧本已依赖且GOWM已托管的配置/证据记录仍须适配。

## 固定命名空间

应用业务SQL指向 `ugv_sdar`。查询设备目录使用 `gowm_device`，空间目标使用 `gowm_task`，canonical关联只读 `ugv_smpp`。共享模式不执行 `public.agent_task`、`public.goal`、`public.remote_task_binding` 等业务SQL。

保留PostGIS/pgvector等扩展的真实Schema引用。不要对整个代码做 `public.` 全文替换。检查显式qualified SQL、regclass、序列、存储函数、prepared statement、表发现和迁移检测路径。

采用显式固定Schema或连接初始化的固定search_path；不要一次pool.query(SET)后假设下一次查询落在同一连接。不得设置整个数据库的全局search_path，不接收用户指定的schema/table字符串。

一个业务连接配置每进程复用有限连接池，不为每个设备创建Pool。若既有Readonly/Worker连接池独立，全部核对实际database和schema。

## 启动只验证

共享模式关闭 `apps/server/src/runtime.ts` 的baseline / planPostV122MigrationFiles应用、init脚本、自动建表/重置/ALTER。原生Standalone安装路径继续受旧模式约束，不能误用到共享库。

启动验证SDAR消费子集：
- GOWM公共设备/目标表与SDAR所需安装记录存在。
- `ugv_sdar.gowm_install_history`中原生family和四层SDAR overlay与摄取记录匹配。
- partial unique index、nullable语义、`canonical_mcp_task_id`触发器、设备归属/父级约束存在。
- 原生Task revision、命令上下文等触发器仍存在，权限满足正常DML。
- pgvector等当前SDAR功能实际依赖可用；不为此执行CREATE EXTENSION。
- 当前逻辑服务绑定的设备与scope匹配。

只校验SDAR所需 `ugv_smpp.provider_task` 等读取结构/权限，不要求SMPP服务在线、无须MCP任务已存在；不得把上游全量verify当启动前置而额外要求无关UGV运行能力。GOWM公共视图当前可能依赖两域安装：测试前验证环境已完整安装，不用空视图伪造通过。

结构不匹配停止本存储模式接纳有副作用工作，给出GOWM_STORAGE_CONTRACT_MISMATCH。无DDL自修复、无旧库fallback。服务不可用沿用正常bounded retry与退出语义。

## 保留事务与Task authority

现有Task revision/command authority、初始Admission、Workflow确认、Continuation、结果提交等事务边界必须保留。

统一事务函数向下传同一个PoolClient；目标绑定、canonical补齐与其对应业务记录需要原子性时使用同一个client，不在子函数中另开pool.query。现有AsyncLocalStorage事务机制可以复用，但不得与可变全局currentDeviceId混用。

MCP调用、模型调用、长时间等待都在数据库事务之外。先持久化意图，提交后外部调用，回执回来再进入结果事务。不能把网络调用包进持锁事务，不能宣称同库能保证跨服务/物理exactly-once。

仅验证Task lineage的诊断查询失败，不应自动重发远程任务。删除/清理策略不得破坏业务历史，见D09。


---

# D03 — 设备上下文与业务归属

## 内部上下文（不是新增公开A2A/MCP字段）

```ts
interface DeviceTaskContext {
  deviceId: string;
  dataScopeKey: string;
  bindingId: string;
  sdarServiceKey: string;
  smppServiceKey: string;
  providerId: string;
  resourceId: string;
  sdarMcpServerId?: string;
  agentProfileId?: string;
}
```

上下文来自部署明确设备绑定、已有结构化入口和GOWM设备目录校验，不来自LLM随意补字段，不按车辆名称/坐标/数组顺序猜测。不另起鉴权平台；复用已有可信请求上下文与数据scope。

设备字符串 `ugv1` 是外部identifier，未必是内部device_id。必须查设备主档并使用真实稳定ID。Agent profile、Resource ID与deviceId不可混用。

## 创建与恢复

任务接纳之前确定归属；设备Task创建一次写入 `device_id / gowm_binding_id / sdar_service_key`，非设备Task三者均NULL。禁止先创建NULL Task后用UPDATE补设备，现有不可变约束不允许这种模式。

运行时恢复、用户输入、确认、取消、结果查询从已保存Task恢复device/service/binding上下文，并校验允许范围。不要按当前设备主绑定重新解释旧任务；服务/资源路由发生变化时遵守既有binding/currentness规则，不能静默切向另一台设备。

保留历史绑定ID与现有MCP authority snapshot。已创建远端Task的查询/取消继续使用其原协议源身份，不修改endpoint/resource使其控制新设备。

## 所有者分类

|类别|处理|
|设备Task、实例、Invocation和Remote Binding|按实际DDL显式写设备，保持父子一致|
|子记录无独立device列|按真实父Task/Binding/Subscription FK链过滤，不临时加列|
|Goal / user_goal_plan / skill_goal / Skill / Workflow模板|允许跨设备复用定义，不依据第一个消费者锁死设备|
|非设备Task|保留显式NULL业务分支，NULL不是全设备通配符|
|没有硬Task FK的来源记录|按GOWM新增字段写device并校验已有父Task；异步/历史合法无父场景仍保留|

设备A、B可以引用同一个共享Goal或Skill。各自生成的Workflow执行Plan和Instance必须能归属各自Task，不能把一个已属A的workflow_plan改成B。

## 请求级与进程级隔离

支持两种简单部署：一个进程明确负责一台车；或一个进程明确负责配置设备集合。两者同Schema。进程级单车选项不允许作为数据库全局DEFAULT。

缓存键检查：执行上下文、Remote Binding查找、MCP会话/凭据路由、待确认Task、模型输入缓存/快通道结果、事件订阅不能按进程单例误共享。纯共享Skill定义缓存可以共享；含业务结果的缓存要包含真实设备/Task/版本。

A2A contextId可以承载多设备对话，不把conversation_context强行绑定成单车；每个Task单独检查设备。禁止“同一个对话所以可以看到另一设备全部Task”。

异步子Workflow、Skill调用、Retry和Continuation必须继承对应父执行的设备上下文，不能依靠请求线程仍存在。


---

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


---

# D05 — 目标图形与实际输入关联

目标是把现有结构化任务输入中的移动终点、观察区域、路线等与Task/Plan/Node Run明确关联；不新增路线、可视域或观察执行算法。

## 来源优先级

1. 已验证的结构化用户/上游目标。
2. SkillInputResolution的实际结构化输入及source refs。
3. 已确认Plan对应Node实际采用的参数。
4. MCP Invocation派发前真实arguments。

从明确Skill schema/语义映射提取目标，不扫描任意JSON中所有x/y，也不让模型在持久化时重新生成坐标。任务使用的原始input与arguments仍原样保存在原生表。

## 三种不同使用角色

```text
Task要求的目标        REQUESTED
Plan节点采用的目标    PLANNED
Node Run实际调用目标  DISPATCHED
```

相同图形、相同语义可以引用同一精确target_id；目标改变使用新修订/新执行记录，不能把已派发目标原地覆盖。

任务目标可能为Polygon，移动步骤的目标则为Point；不能把Task的整个区域无条件复制成每个移动Node的参数。

## 空间语义

明确EPSG:4326输入才允许标准化WGS84；若原生是 `{x,y,frame}`，完整保留原参数，并基于明确frame映射形成native目标。局部坐标使用真实原生frame，geometry_wgs84为空。`ST_SetSRID`只是标记，不是坐标转换。

frame缺失时不伪造EPSG:4326。保留原始structured_input_json/source refs并输出TARGET_CRS_UNRESOLVED；是否阻止设备调用沿用现有输入有效性规则，不因为新增展示图层额外禁止既有合法工作。不得把未生成标准几何的情形说成“已标准化”。

GOWM createTarget/target表接受的几何格式、枚举与native_crs约束以当前实现为准。本包不引入新的CRS服务，也不修改GOWM来接受临时格式。

## 公共owner合同

SDAR只生产owner_domain=SDAR的关系：

```text
TASK      {taskId}
PLAN_NODE {planId, nodeId}
NODE_RUN  {bindingId, instanceId, nodeId, nodeRunId}
```

使用GOWM当前JSONB owner_key和唯一键；不拼接未定义的字符串owner、不使用SMPP旧storeId。

GOWM NODE_RUN当前通过remote_task_binding验证，因此只有真实Remote Binding存在后才附加该关系。同步MCP调用无Remote Task时，保留真实Invocation参数及已有Task/Plan目标，不伪造Remote Binding来满足owner校验；在报告中说明当前合同的这一表示边界。

SDAR不得生产 `owner_domain=SMPP / UGV_PROVIDER` 的目标绑定。MCP Task、Provider Dispatch的目标采用关系由并行SMPP任务负责。

## 事务和幂等

新增任务目标时，与Task/输入记录使用同一业务事务；Plan目标与执行Plan保存同事务；Remote Binding创建后与准确NODE_RUN目标同事务。

读取GOWM `createTarget / attachTargetToOwner / validateOwner` 的实际SQL，在SDAR边界实现窄适配或复用可安装的已发布包。不能依赖运行时import兄弟仓库src，也不要fork整套GOWM Repository。

避免每次重试创建孤立target revision：先按准确owner和角色检查已有绑定，一致重放复用，变化明确冲突或创建新计划/新执行尝试。并发创建同一目标/owner需要受数据库唯一键和既有事务控制，不能出现一条原生记录绑定两个不一致实际目标。

验证范围：Point、Polygon、可用的LineString、局部坐标、Task区域与Node移动点不同、计划修订、Node重试、事务回滚和重复回执。


---

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


---

# D07 — Worker、恢复与缓存设备范围

共享数据库真正的风险不只是写入缺列，还包括后台循环读到另一台设备。逐项追踪所有实际运行循环，生成 `worker-scope-inventory.json`，记录查询、scope入口、claim token、过期条件、恢复方法及测试。

## 必须覆盖

|路径|范围来源|
|初始任务领取、计划准备、SkillGoal/TaskAttempt调度|实际Task归属，不能从共享Goal/模板推断|
|Remote Task Admission恢复|Intent关联Task及其设备|
|Remote polling / notification / input / cancel|Remote Binding的device、service和原authority snapshot|
|Workflow continuation、子Workflow恢复|对应instance/Task/Node Run身份|
|用户输入等待超时、取消协调、终态投影修复|原Task设备范围|
|业务事件订阅/收件箱/连续性评估|subscription绑定设备和smpp_service_key|
|Evidence/Artifact/临时Skill等后台处理|真实来源Task存在时沿其归属；共享目录按服务级工作处理|
|保留和清理|有设备归属的历史只在明确范围处理，见D09|

Task级循环传 `allowedDeviceIds` 并JOIN真实父链。不能只加SKIP LOCKED；不能用 `device_id IS NULL OR device_id=ANY(...)` 把非设备记录当任意设备工作。非设备通道沿既有配置显式启用和处理，不偷偷归为第一台车。

一个明确单设备进程可以只处理一个deviceId；双设备可以是两个进程，也可以是显式多设备Worker。两者使用同一Schema和同一正常Repository实现，禁止测试专用改表名隔离。

## 并发与接管

保持原生poll/continuation/admission claim token、version、过期时间和锁顺序。同一任务同时被两个Worker竞争时只能一个成功领取；过期后合法接管；旧token不能提交新结果。

服务级后台工作如果原本没有设备，应使用现有稳定服务级协调，不伪造deviceId，也不在每台车上重复运行同一个共享catalog更新任务。

所有恢复查询与更新都包含相同scope条件；先按全库claim再在业务层丢弃不属于自己的记录不是正确实现。

## Redis / BullMQ / 内存路径

数据库改造时同时核查现有queue、缓存、event subscriber和AsyncLocalStorage：
- 队列payload保留Task/Binding身份，出队时回读并核验设备，不依赖当前进程默认车。
- 不必为每设备新建Redis实例。复用既有前缀/队列，必要key加入设备或逻辑服务，但不改变全局UUID已提供的唯一性。
- 客户端会话和provider binding缓存不得把server别名相同的不同服务/资源混用。
- LLM/embedding client可以共享；含任务结果和上下文的缓存不得跨设备复用。
- 路径不再依赖request线程存在才能恢复deviceContext。

## 故障与取消

数据库短暂失败使用既有退避，不热循环，不fallback旧库。MCP响应已到但本地保存失败，按现有Admission/Idempotency流程恢复同一次操作，不用新key重新调用设备。

取消、暂停、恢复、输入提交均使用原Remote Binding身份。仅数据库存储关联失败不能触发远程取消，更不能把另台车的同号Task作为目标。


---

# D08 — 业务事件、A2A投影及证据归属

## 事件订阅最终键

GOWM `sdar-derived-ownership.sql`已规定：

```text
设备current: (device_id, smpp_service_key, provider_id) WHERE status='current' AND device_id IS NOT NULL
设备generation: (device_id, smpp_service_key, provider_id, stream_id, generation) WHERE device_id IS NOT NULL
非设备current: provider_id，独立partial index
非设备generation: provider_id, stream_id, generation，独立partial index
```

适配初始化/UPSERT、current查询、generation切换、去重、游标推进、重放和关闭订阅。不得沿旧provider_id单例返回另一台车的订阅。

inbox、continuity、relation等子记录通过真实subscription_id继承范围；不要对不存在device列的表盲加条件。订阅切换保持旧generation历史，不把旧事件写进新generation。

本任务只消费现有SMPP business event合同，不要求并行SMPP新增事件字段。事件来源无法唯一归属时保留原拒绝/未知语义，不按当前agent猜设备。

## 没有硬Task FK的业务来源

至少核对以下已由GOWM增device列的表及所有写入路径：

```text
external_task_projection
artifact_execution
artifact_match_log
episode_evidence_manifest
evidence_expected_record
evidence_outbox
fast_gateway_request
planning_correction_fact
planning_interaction_episode
runtime_task_configuration_binding
runtime_task_model_route_binding
temporary_skill
temporary_skill_experience
workflow_plan_attempt
```

这些新增字段必须由真实Task上下文提供。父Task存在时要求一致；原设计允许历史或异步来源暂时没有父Task的场景仍可保留，不能靠补假Task满足校验。

`goal / user_goal_plan / skill_goal`及知识模板仍可能共享。业务归属由实际执行Task确定，不对共享对象强制写设备所有权。

## A2A与管理读取

A2A Task Store、事件流、结果投影、管理列表/单条读取应正确限定设备范围，但对外继续遵守现有A2A协议。不得把数据库source字段硬塞进严格不允许额外属性的A2A任务体。

Task metadata、provenance允许位置可沿既有扩展约定表达；强制路由信息应在服务端context和持久化字段，不能依赖客户端随意传入的payload。

## 证据与完成判定

保留已有Result/Evidence存储与导出功能；禁止为任务主数据另外增加导出采集链。既有evidence_export表属于已托管运行依赖，不应被误删。

从GOWM lineage读到Mission映射可以用于关联解释，不能替代原物理结果证据或让目标达成判定自动成功。未适配SMPP时显示PROVIDER_PENDING/未关联，不伪造设备状态。

若沿用当前物理证据Repository，新增canonical link可作为明确JOIN依据，但不绕过现有Task/Admission/receipt authority和版本校验。


---

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


---

# D10 — 并行测试环境与验证层级

## 必需的独立测试

本任务不依赖SMPP分支完成。建立：

```text
真实GOWM已安装的隔离PostgreSQL
    ├─ ugv_sdar：由真实SDAR代码写入
    ├─ gowm_device / gowm_task：当前合同
    └─ ugv_smpp：测试同伴按合同发布必要的合成MCP行

真实SDAR正常应用路径
    ↔ 当前Frozen MCP协议测试桩
```

MCP桩提供tools discovery、Task接纳、poll、result、input/cancel和必要events，使用仓库当前协议Schema验证，不臆造新版协议。

模型可采用现有deterministic model fixture，任务输入、计划确认、工作流、MCP调用、回执处理和A2A终态经过生产代码。明确测试不依赖真实LLM API。

## 数据库准备

只使用显式 `GOWM_BUSINESS_TEST_DATABASE_URL` 与 `GOWM_BUSINESS_SMOKE_ENABLE=true` 的隔离库。测试库与并行SMPP工作使用不同名称，避免互相清理；隔离的是测试环境，不是为每设备建立业务Schema。

沿GOWM已有安装器/交接SQL准备，遵守其core和extension前置，不在SDAR实现另一个迁移所有者。可由只读检出的GOWM代码安装到测试库，输出放在SDAR报告目录或临时目录，不改GOWM源码。不能为了方便从旧未包含078的main安装。

默认命令不依赖Docker；可使用已部署测试PostgreSQL及现有Redis。若正常路径需要Redis，使用显式隔离Redis database/key prefix或现有可替换队列端口，不能假装生产队列未参与。需要数据库的测试缺环境输出NOT_RUN；单元/合同继续运行。

## 两个设备与重复身份

同库同Schema登记A/B两个测试设备、服务绑定，使用同名nodeId、相同caller idempotency文本、相同协议桩remote task文本及相同provider/stream局部标识。实际SDAR内部Task/Plan/Instance/Run身份仍按真实代码生成。

业务链最少包含：
- 一个Point移动目标。
- 一个Polygon观察目标；沿已有Skill输入或测试注册的无害fixture Skill，不新增实际观察控制能力。
- 同名Node的Retry或循环及一个未执行分支。
- 正常终态、取消、等待输入、重启恢复。

## 桩的写入边界

生产SDAR的数据库角色不授予ugv_smpp DML。只有测试同伴/Fixture Seeder的独立测试角色可在隔离库发布GOWM约束允许的合成provider_task；必须标记 `SYNTHETIC_MCP_PEER`，不执行真实设备、不给实际Mission通过结论。

SDAR必须只消费其协议回执并验证表中canonical父记录。不能在SDAR运行代码中偷偷加入 `ensureProviderTask` 创建假SMPP数据。

测试应有两个时序：
1. 父MCP行先发布，再返回Task回执：立即解析canonical。
2. 回执先返回，父行后发布：先保存NULL，后续关联补齐；没有第二次MCP创建调用。

还要验证无父记录/不透明远端ID时SDAR保留有效协议结果、未解析关联与准确报告，不假称全链已闭合。

## 共享协议身份不改造

父行UUID必须来自桩真实返回的匹配Task身份，而不是SDAR随机生成一个ID。故意返回不透明ID的场景只能在桩提供明确映射证据或协议允许时解析；否则保持未解析。

## 实际GOWM回读

从 `gowm_business_v1.sdar_tasks / workflow_steps / task_target_geometries / task_execution_lineage` 验证自己的记录。canonical已知但Provider/Mission未产生时，read model仍可能给PROVIDER_PENDING，属预期，不通过伪造Mission让状态变LINKED。

Task lineage分别查看steps、targets、lineage，确保Native Event与Remote Node Run未笛卡尔合并。

## 可选双方联调

SMPP并行分支可用后，使用它的正常Runtime在另一个显式测试环境运行一次互操作。只读取/调用它，不修改其代码。报告实际两仓commit、合同、协议请求ID、SDAR Task、Remote ID、canonical ID及GOWM回读。

这项未运行不阻碍本任务SDAR存储INTEGRATION_DEV_READY；不得把桩测试写成真实SMPP联调PASS。


---

# D11 — 实施阶段与验证命令

|阶段|内容|主要交付|
|P0|当前基线、上游合同和全路径SQL盘点|schema-consumption-matrix、来源与差异|
|P1|共享模式、连接/启动验证、设备上下文|正常server配置与Pool装配|
|P2|Task、初始Admission、Plan/Workflow/Node|设备归属、partial index、原生authority回归|
|P3|结构化输入与目标图形|Task/Plan/Run目标事务绑定|
|P4|MCP Invocation、Remote Binding及canonical补齐|完整上下文、延迟关联、协议边界|
|P5|Worker/Continuation/事件/证据/清理|双设备领取、恢复和历史保留|
|P6|正常应用装配和独立测试|真实PostgreSQL+SDAR路径+MCP桩|
|P7|回归、交接、报告与Draft PR|最终状态和可选互操作入口|

P0完成后尽快实现一个最小正常请求贯穿数据库，再扩展其余路径；不要先堆大量治理框架。各阶段可小步提交，无须为每个阶段新增人工审批或等SMPP合并。

## 当前仓库工具链

本次观察 `packageManager=pnpm@11.7.0`、`engines.node>=20.19.0`、根版本1.4.1；执行时遵循实际package.json/lockfile。不要照搬GOWM的npm run check，也不要默认升级依赖。

基本回归：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm verify:architecture
pnpm verify:protocol
pnpm verify:migrations
```

`pnpm test`当前是unit+contract项目。上述脚本缺失/改名时选实际等价命令并记录，不伪造执行结果。format:check至少对修改文件按项目现有格式要求通过；全仓历史格式差异单列，不借机重排无关文件。

本任务新增建议脚本（命名可按项目规范一致调整）：

```text
gowm-storage:check                 离线合同/Schema消费清单检查
gowm-storage:verify                显式连接数据库，只读验证SDAR子集
test:gowm-storage:unit             新增单元和合同回归
test:gowm-storage:postgres         真PostgreSQL、设备键、事务及查询
test:gowm-storage:runtime          正常SDAR路径+真DB+MCP桩
gowm-storage:smoke --help          无连接、无Docker的用法说明
gowm-storage:interop               可选已适配SMPP真实互操作
```

help/check不自动连接线上环境。需要数据库的测试缺环境显式NOT_RUN，不计入已执行PASS。保留原有integration/e2e测试中与本改造有关的场景；不默认启动有Docker/实车前置的全量release/HA资格流程。

## 建议提交

```text
feat(storage): add GOWM shared schema configuration and verification
feat(storage): propagate device context through task and workflow persistence
feat(storage): persist target geometry lineage
feat(storage): scope remote task bindings and resolve canonical MCP identity
fix(storage): scope recovery events and retention by device
 test(storage): verify dual-device shared PostgreSQL runtime flow
 docs(storage): document parallel SDAR shared storage integration
```

实际提交可合并，不要求凑数量。不得强推、合并、Tag、Release、部署或切换用户实例。


---

# D12 — 验收与交付口径

机器验收条目见 `acceptance.json`，测试设计见 `test-scenarios.json`。包内这些状态都是待执行设计，不是项目测试结果。

## Required核验

实现必须涵盖正常路径，不允许靠测试专用Writer代替业务Repository。检查、协议回归、已有Task authority、目标绑定、延迟canonical、设备领取、事件订阅与数据库事务均需有证据。

SOURCE_READY只适用于代码工作已完成且无已执行必需测试失败、但环境验证尚未运行。缺GOWM schema能力导致某项必需实现无法工作，应报告INCOMPLETE及准确缺口，不用环境NOT_RUN掩盖设计冲突。

INTEGRATION_DEV_READY要求本任务真实数据库和正常SDAR代码路径通过，但允许MCP同伴是明确标注的协议桩。真实SMPP互操作单列，不与桩结果混淆。

## 报告位置

```text
reports/sdar-gowm-shared-storage-integration-v0.1/
  FINAL_REPORT.md
  FINAL_REPORT.json
  schema-consumption-matrix.json
  worker-scope-inventory.json
  acceptance-results.json
  postgres-results.json
  runtime-smoke-results.json
  optional-smpp-interop.json
```

只记录真实命令、exit code、数量和运行范围；未运行报告NOT_RUN，不拷贝GOWM旧PASS作为本次证据。记录实现提交/树即可，不建立报告文件引用自身最终提交的循环门禁，不因上游HEAD变化反复重测。

## 后续消费者交接

输出 `docs/gowm-shared-storage/README.md`、配置示例、旧库保留/新库独立启动说明、并行边界、人工切换前检查、已知限制。不要生成自动DROP旧库、自动搬迁旧数据或启动真实控制的脚本。

给SMPP工作线的最小对接说明仅包括：双方使用的deviceId/service/provider/resource绑定、当前MCP合同、Remote ID到canonical的确定条件、各自写表范围和测试调用方式。SDAR不依赖SMPP代码目录、不强制等待SMPP新提交。

## 上游缺口处理

`UPSTREAM_STORAGE_GAP.md`记录具体DDL/触发器、失败SQL、实际参数结构、最小复现和缺少能力。不执行ALTER、不关闭约束、不增加shadow业务表。能通过本仓SQL/传参/事务修正的不是上游缺口，应自行完成。

## 交付动作

在单独分支提交并推送，创建Draft PR：

```text
feat(storage): integrate SDAR with GOWM shared device business storage
```

无网络/写权限时如实保存本地提交和PR说明，标注交付未完成，不虚构URL。不自动合并、发布、打Tag或部署。


---

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
