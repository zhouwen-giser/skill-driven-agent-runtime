# GOWM 共享存储接入（实施中）

本轮目标与进度见 `execplans/EP-GOWM-SHARED-STORAGE-INTEGRATION.md`。正常 Server 双设备 Skill/DSL/LangGraph、Remote 恢复及延迟 canonical 已有隔离 PostgreSQL 和本地协议桩证据；父 Task 取消、子调用与事件有分项记录。当前整体仍为 **INCOMPLETE**：临时 Skill 终态触发器与辅助 Provider link 有上游合同缺口，外围范围和最终开发交付未完成。不可据此切换用户运行实例。

下文保留接口说明；历史阶段性未完成描述以本文“当前限制”和 ExecPlan 顶部为准。

```dotenv
SDAR_STORAGE_MODE=gowm-shared
GOWM_DATABASE_URL=postgresql://ROLE:SECRET@HOST/EXISTING_GOWM_DATABASE
SDAR_SERVICE_KEY=stable-sdar-service
SDAR_DATA_SCOPE_KEY=registered-data-scope
SDAR_ALLOWED_DEVICE_IDS=["registered-device-A","registered-device-B"]
SDAR_INCLUDE_NON_DEVICE_TASKS=false
# SDAR_DEVICE_ID=registered-device-A
SDAR_GOWM_CONTRACT_DIR=contracts/gowm-shared-storage/current
```

共享模式 GOWM_DATABASE_URL 明确优先于旧 SDAR_POSTGRES_URL；同一个 Runtime 只有一个业务 Pool，Node Control 管理库不迁移。固定连接 search_path 为 ugv_sdar,public,pg_catalog；public 保留扩展定位。URL 不允许覆盖连接 options。共享启动仅验证，不执行 baseline/增量迁移，不创建扩展、Schema、设备或服务绑定。

设备 allowlist 是 JSON 数组，空集合不允许任何设备。单设备默认值必须显式配置且属于 allowlist；不取第一项，不默认 ugv1。非设备工作由独立开关启用。历史 Task 必须沿已保存 binding 恢复，不能重新采用当前绑定。

GOWM 合同原文与 MIT 许可证位于 `contracts/gowm-shared-storage/current`。这些 SQL 仅供离线参考，禁止作为 SDAR 安装入口执行。MCP 创建/轮询/输入/取消仍走现有 Frozen 协议，SDAR 不写 ugv_smpp 或 Mission 表。测试同伴可在明确隔离库以独立角色发布合成父行；不冒充真实 SMPP。

离线 `pnpm gowm-storage:check` 只证明摄取文件与原生迁移基线一致，不证明实现完成。`pnpm gowm-storage:verify` 仅做只读验证，要求显式 GOWM_BUSINESS_TEST_DATABASE_URL 和 GOWM_BUSINESS_SMOKE_ENABLE=true；缺环境返回 NOT_RUN/2。`pnpm gowm-storage:smoke --help` 不连接数据库或启动 Docker。

本轮不迁移历史数据、不删除旧库、不切换运行实例。后续完成验收后仍由用户安排独立实例配置；本任务交付 Draft PR，不 merge/tag/release/deploy。

正常 Task 入口在共享模式使用 `metadata["io.sdar/deviceId"]` 作为设备选择器，服务端只使用配置的数据范围和 GOWM 目录中的真实 binding/service。metadata 自称的 binding 不构成 authority。单设备配置可省选择器；显式非设备通道使用 `metadata["io.sdar/nonDevice"]=true`，且须配置允许，不能同时给 deviceId。内部子调用可传已经冻结的 ownership，仍须目录和允许范围校验。这些是既有 metadata 的扩展使用，不新增 A2A Task 顶层字段。


## 显式空间字段（部分链路已接入）

已注册 Skill/MCP 输入 Schema 可声明 `x-sdar-targets`。这是 Schema 注解，不是新增的 MCP 请求字段；注册仍走原管理 API 和严格 Schema 校验。示例：

```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "object",
      "properties": { "x": { "type": "number" }, "y": { "type": "number" } },
      "required": ["x", "y"],
      "additionalProperties": false
    },
    "frame": { "type": "string", "minLength": 1 }
  },
  "required": ["target", "frame"],
  "additionalProperties": false,
  "x-sdar-targets": [
    { "argumentPath": "/target", "purpose": "move-destination", "format": "xy", "crsPath": "/frame" }
  ]
}
```

`format` 为 `xy` 或 `geojson`；后者支持 Point/LineString/Polygon。`crsPath` 为输入的 JSON pointer，或以 `crs` 声明 Schema 固定坐标系，两者不能同时出现。坐标轴保持原顺序；只有明确 `EPSG:4326` 标准化，其他 frame 保持 NATIVE_ONLY。没有 Schema 映射时不扫描 JSON；缺少 CRS 时保留原输入并写 `task.target_diagnostic` / `TARGET_CRS_UNRESOLVED`。注解不会替代原输入 Schema 的必填和类型约束，也不会使不合法输入获得执行权限。

已实现：正式 SkillInputResolution 保存 REQUESTED，实际静态 Plan 节点参数保存 PLANNED，均与原生记录同一事务；精确 owner/role/argumentPath 的重复目标复用，不同目标显式冲突。新 Plan 可保存新目标，失败则连同原计划 supersede 回滚。源记录保存输入 Schema hash 与 resolution/plan/node 来源。动态 Workflow 引用在解析前不被当成坐标；真实 Remote Binding 创建事务现从实际 Invocation 参数保存 DISPATCHED；实际 Invocation/Remote 链使用冻结的工具输入 Schema；正常 Remote 代表链已有记录。同步 MCP 无 Remote Task 时不能构造 NODE_RUN owner。

验证边界：正常 Server 已证明 Point 的 REQUESTED/PLANNED/DISPATCHED 和冻结 Schema；Polygon/LineString、修订回滚为单元/仓储层证据，不宣称所有几何均已完成正常 Server 全链。

## MCP 与恢复范围（部分验证）

共享 Invocation 不能自行指定权威 device_id；Repository 从 Task 的不可变目录绑定推导并验证 server/resource。显式非设备通道不允许访问目录中任何设备绑定的 server。Remote 身份采用 device_id、smpp_service_key、server_id、remote_task_id；opaque handle 不被猜测为 GOWM 主键。canonical UUID 仅在持久 receipt、discovery snapshot 和父表完整身份一致时补齐；缺失/冲突记录诊断并保留 NULL。终态 Binding 可补齐关联，不重新发送远端调用。

Admission 观察、恢复列表、CAS 更新及失败回查沿 Task 过滤；进程丢失恢复沿 Task/Plan 只更新范围内记录。cancellation/input/continuation/订阅/事件已有范围实现及分项验证；retention 和外围路径仍有开放项。历史 13 组记录为较早仓储证据，后续正常 Server 链见 reports/sdar-gowm-shared-storage-integration-v0.1/ 中 execution-* 报告。测试 consumer 对 SMPP 无 DML，独立 peer 仅在本 Goal 的隔离库发布合成父行。

## 固定合同中的远端输入来源

GOWM 固定 source 枚举不含 remote_task。共享 Remote input activation 在同一事务写 workflow 请求和真实 remote_task_input_link；普通 Task Input 读取、回答和 attempt 恢复使用这条精确关系还原 Domain remote_task。无 link 的普通 workflow 保持原来源，独立 remote_task createRequest 被拒绝。该表示不会修改 GOWM 枚举或引入影子记录。

取消、补参及生命周期 Repository 已传递同一设备范围；直接查询、投递扫描、锁定、attempt 和回执均校验父级。当前真库证明取消隔离、持久请求的回答事务与补参恢复；正常 continuation 恢复与 binding 取消已有本地协议桩证据；真实进程重启和全部迟到回调组合仍未证明。

Continuation 快照和 worker inbox/control/attempt 也已按持久 Task 范围过滤，并校验 Plan、Instance、Control 和 wait Binding 的真实关系。重复保存采用 canonical 内容比较，不改写旧快照。当前真库 fixture 为可识别旧版 1.0 状态；正常 Server 的 2.0 执行/恢复仍需后续协议桩全链证明。

Reconciliation 与辅助 Provider execution link 已沿 Admission/Binding/Task 做范围过滤。当前辅助表的全局 server/handle 唯一键仍不能承载两设备同 handle 的两个辅助 link，见 `auxiliary-link-contract-gap.json`；这是开放的合同能力缺口，不是环境故障。原生 Remote Binding 完整键和延迟 canonical 验证结果不因此被扩大为所有辅助关联通过。


## 当前开发验证入口（2026-09-08）

`pnpm test:gowm-storage:runtime --help` 只打印用法，不连接数据库。实际运行需要显式加载既有隔离 runtime-test.env：`node --env-file=.state/gowm-storage/runtime-test.env --import tsx scripts/gowm-runtime-execution.mts`；`--remote` 验证远程结果与延迟 canonical，`--cancel` 验证 binding 取消及新计划等待确认。均使用本地 Model/MCP 桩，不表示真实 SMPP/模型验证。

前文早期“正常 2.0 尚未验证”状态由现有 ExecPlan 的正常运行证据更新：2.0 远程恢复、Point 目标、延迟 canonical、Skill 子调用和事件 ingress 已有分项证据，不能扩大为全量验收通过。后台清单见 `reports/sdar-gowm-shared-storage-integration-v0.1/worker-scope-inventory.json`，明确保留未装配/未证明项。

完整接入仍 INCOMPLETE：辅助 Provider link 唯一键及临时 Skill 原生终态经验归属存在已复现合同冲突，见 [UPSTREAM_STORAGE_GAP.md](UPSTREAM_STORAGE_GAP.md)。不部署共享服务，不迁移旧数据，不因局部 PASS 宣称 DEV_READY。

## 当前限制与复用验证入口

- 上游原生 Task 终态触发器遗漏临时 Skill experience 的 device_id，终态事务会回滚；辅助 Provider link 全局唯一键不能表达两设备同 handle。见 `UPSTREAM_STORAGE_GAP.md`，SDAR 不更改上游结构或绕过约束。
- `pnpm test:gowm-storage:runtime` 使用隔离库和本地模型/MCP。`--remote` 覆盖等待恢复和延迟 canonical，`--cancel` 覆盖 binding 取消，`--parent-cancel` 经官方 A2A 客户端验证父 Task 取消。后者不等于 Provider 已终止。
- runtime fixture 仍可能因旧的本地模型路由出现启动 embedding 告警；单次链路 PASS 不代表整个部署健康。
- 保留旧库并使用独立实例显式配置 GOWM。目录绑定、受限角色与只读合同检查通过后仍须核对上述阻塞和最终报告；本任务不自动搬迁数据、切换实例或清理用户资源。
