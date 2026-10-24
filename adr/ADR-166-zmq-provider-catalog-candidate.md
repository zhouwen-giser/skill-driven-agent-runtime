# ADR 166 — 独立 ZMQ Provider 目录候选

Status: Accepted for isolated implementation, 2026-10-24. Field publication pending.

## Context

SMPP 原生 ZMQ Provider 使用独立的 12 工具目录，四点严格凸区域须显式椭球高。
检查报告只有逐帧观测和未知完整性的 PUB 来源；效果执行与迟到补充结果相互独立。
现有 vehicle_inspect_area / embodied.inspect_area / embodied.area_patrol 的冻结合同不等价。

## Decision

新增 zmq_v1_12 显式消费者合同。逐个比较输入、输出、Task Profile、资源及执行语义；
候选固定 Provider、Binding、Registry 和目录 revision/checksum、simulationId 和新鲜度。
目录校验不创建调度或控制权限。候选不得自动发布，物理操作仍须既有 CAS 治理和计划确认，
禁止重放。时间窗预算为父任务剩余值与 300 秒较小值，不可通过重新锚定延长期限。

新候选使用独立 ugv.zmq.* / vehicle.ugv.zmq.* 身份，不替换旧 Skill。
旧巡逻不自动组合新检查。缺失足迹、任务轨迹和完整源流的报告持续降级；即便比例为 1
或收到有效空帧，也不宣称区域覆盖完整。迟到效果只通过独立结果查询读取，不改原任务或 Context。

## Scope / open work

本 ADR 实现精确候选及确定性适配器，提供正式 SMPP Runtime 的只读跨仓库目录验证器。
正式 SDAR 治理发布、原生任务链及巡逻后继组合尚未验收；列在 EP-ZMQ-05。
G0 现场身份、时钟、坐标/高程、相机限制、实现版本及金帧未齐备，不能由隔离模拟替代。

## Verification environment repair — 2026-10-25

当前宿主机新建 Compose bridge 的容器内 PostgreSQL/Redis 正常，但宿主机回环端口连接超时；
同样镜像、卷、端口改用 Docker 默认 bridge 后两个宿主机探测均通过。一次自动分配还选择了
包含现场地址的 192.168.0.0/20；诊断项目已撤销，不能将该网络用于后续验收。

隔离 runner 新增显式 `--docker-default-bridge` 选项，生成只覆盖任务自有 PostgreSQL/Redis
服务网络设置的临时 Compose overlay。默认验证行为及发布用 Compose 原文件保持原合同；
该选项只接受四个清理白名单项目身份，不接受共享项目或任意文件。
仍要求独立容器/卷、回环发布、真实宿主机探测、原测试阈值和完整清理，并记录 overlay 哈希。
默认 bridge 与其他容器共用二层网络，隔离范围是自有项目、数据库、卷和回环端口；不得作为
多租户网络隔离或现场部署证明。未修改宿主机代理、路由或防火墙。

## Evidence

packages/ugv-profile/test/zmq-provider-profile.unit.test.ts；scripts/ugv-zmq/verify-smpp-catalog.mts；
reports/ugv-zmq-phase5。完整门禁结果以本次报告为准，不引用历史通过关闭新增缺口。
