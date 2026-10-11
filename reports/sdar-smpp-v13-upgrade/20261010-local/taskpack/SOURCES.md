# 来源与证据边界

本包将已读取事实、既有交付记录、用户约定和拟新增设计分别标注；链接固定到提交，不把分支最新状态当作冻结合同。公开搜索没有提供可用仓库证据，设计事实取自 GitHub connector 读取的原仓库资料。

## S01 · SDAR PR #34 元数据

[原始来源](https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/34)

2026-10-10 读取时为 Open / Draft；base 与 head 见 BASELINE.lock.json；后续启动必须重读。

## S02 · SDAR 适配边界文档

[原始来源](https://github.com/zhouwen-giser/skill-driven-agent-runtime/blob/52f54a11a40380f7c73bd9da277d640e49bdfbf7/docs/SDAR_SMPP_UGV_V13_ADAPTER.md)

已存在受管业务读取入口；业务写入尚需真实治理绑定；部署兼容目标固定为 SMPP 0a4a7c3。

Git blob SHA：`a0356d6842e01c6945d310369804e0b033e6943b`。

## S03 · 仓库 Codex 规则

[原始来源](https://github.com/zhouwen-giser/skill-driven-agent-runtime/blob/52f54a11a40380f7c73bd9da277d640e49bdfbf7/AGENTS.md)

保留 LangGraph、严格模型校验、确认边界、持久化权威和可复现验收；不能自动重放运行中任务。

Git blob SHA：`764affaf26a250ef58b92c2a5a25522d732d3e07`。

## S04 · ExecPlan 规范

[原始来源](https://github.com/zhouwen-giser/skill-driven-agent-runtime/blob/52f54a11a40380f7c73bd9da277d640e49bdfbf7/PLANS.md)

ExecPlan 包含十二个指定章节；需求、实现、测试、证据应形成映射。

Git blob SHA：`e304a3ca8f305567ae5c613fae422a3125d63d0d`。

## S05 · 真实脚本与依赖版本

[原始来源](https://github.com/zhouwen-giser/skill-driven-agent-runtime/blob/52f54a11a40380f7c73bd9da277d640e49bdfbf7/package.json)

packageManager 为 pnpm@11.7.0；本包验证命令以该文件为依据，不借用 SMPP 的 pnpm 版本。

Git blob SHA：`840eded3d80852782c9aa17ff7f51e1bc61dd6e9`。

## S06 · 现有应用层导出

[原始来源](https://github.com/zhouwen-giser/skill-driven-agent-runtime/blob/52f54a11a40380f7c73bd9da277d640e49bdfbf7/packages/application/src/index.ts)

确认 remote-task、business-events、governed-control、skill 等模块的实际入口；仅导出不代表已审查内部全部行为。

Git blob SHA：`427f4c2dee36073ad84af61ddc143e214692288d`。

## S07 · 既有 RemoteTaskInputService

[原始来源](https://github.com/zhouwen-giser/skill-driven-agent-runtime/blob/52f54a11a40380f7c73bd9da277d640e49bdfbf7/packages/application/src/remote-task-input.ts)

已有等待激活、输入归一化、发送及不确定结果记录；新链必须复用并查清事务边界。读取范围为原文件 1–240 行。

Git blob SHA：`558a9fbcd6bbb71291eed2563492ad333dde7161`。

## S08 · 既有业务事件订阅与 inbox

[原始来源](https://github.com/zhouwen-giser/skill-driven-agent-runtime/blob/52f54a11a40380f7c73bd9da277d640e49bdfbf7/packages/application/src/business-events.ts)

已有 subscription/inbox/continuity 和 admitted/processed 双位置；禁止另建重复事件基础设施。读取范围为原文件 1–250 行。

Git blob SHA：`421b48d18976088be9e0da515bae50c95cd738c7`。

## S09 · 现有 SmppTaskBusinessClient

[原始来源](https://github.com/zhouwen-giser/skill-driven-agent-runtime/blob/52f54a11a40380f7c73bd9da277d640e49bdfbf7/packages/mcp-adapter/src/smpp-task-business-client.ts)

Context/Artifact/续传及 Input/Intervention 预检已存在。写入方法 wire payload 以原代码和冻结上游合同共同核对。

Git blob SHA：`c4764d4b3fd1a61eae46493ef064f1214da3b71d`。

## S10 · 现有 PostgreSQL 导出

[原始来源](https://github.com/zhouwen-giser/skill-driven-agent-runtime/blob/52f54a11a40380f7c73bd9da277d640e49bdfbf7/packages/persistence-postgres/src/index.ts)

确认远端输入、绑定、continuation、控制授权等存储入口；新增存储优先复用。

Git blob SHA：`a71a4c7aea6690aa5053cdb600a0467727ff1bde`。

## S11 · 已部署版本的 Provider 公共接口指南

[原始来源](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/blob/0a4a7c36865d4c9920a4e65857c0903e9ef12533/docs/ugv-provider-mcp-api-guide.md)

前一轮已核对公共请求头、分页、公开游标、导航调整和 Input 规则；历史文档中的现场状态不能替代启动时探测。

## S12 · 已部署版本的现场交付记录

[原始来源](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/blob/0a4a7c36865d4c9920a4e65857c0903e9ef12533/reports/ugv-business-simplification/SITE_DELIVERY.md)

作为既有部署记录定位入口；不是本任务包生成时执行的新现场验收。

## S13 · PR #34 专项 CI

[原始来源](https://github.com/zhouwen-giser/skill-driven-agent-runtime/actions/runs/38033079355)

2026-10-10 通过 GitHub connector 核对到该 HEAD 的 SMPP UGV v1.3 Adapter workflow conclusion=success；不等于全项目或现场通过。

## U01 · 用户与当前方案约定

以 UGV Provider 提供的接收时间作为源时间；保留完整轨迹与确认链。development 无凭据、默认 live、设备不修改、最小复杂度、不扩展 PMS-api/pms-web、不提供独立 SDK。发射始终禁用。本轮只生成任务包，不执行仓库变更和现场操作。

## 证据使用限制

来源中的单元测试通过、代码完成、历史部署成功均只能按原范围引用。不能把来源日期改成新验收日期；不能把专项 CI 当完整开发门禁；不能把 mock 或录制回放称为现场验证。未读取的 ADR、需求规格与具体迁移编号应在 W0 首先核对，本包不虚构其内容。
