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
