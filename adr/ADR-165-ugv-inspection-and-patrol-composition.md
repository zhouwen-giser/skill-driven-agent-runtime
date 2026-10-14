# ADR 165 UGV 区域检查与巡逻组合

Status: Accepted for user-authorized implementation, 2026-10-14.

## Context

现有 UGV 区域侦察的参数和结果不能满足 embodied.inspect_area，巡逻依赖必须保持阻塞。用户现已授权 SMPP 提供检查任务并同时闭环 SDAR。

## Decision

由 SMPP 新增 vehicle_inspect_area，复用原生侦察生命周期、业务对象、来源关联与 JSONB 存储。SDAR 通过精确治理绑定发布 embodied.inspect_area，后继巡逻组合传递资源、区域和父任务时间窗。缺失证据、未知覆盖和截断禁止完整成功；所报告发现限于任务关联的目标与事件事实。

第一版只处理 WGS84 合法子区域，不猜测坐标系、不忽略未解析排除区。目录新增以明确 13/14 工具配置承载，旧配置保留。发布及本地验收不得自动创建现场巡逻任务。

物理子任务分别拥有原生 Task、Goal、Capability 绑定、独立确认及 continuation，继承相同设备所有权。组合元数据只用于关联；父版本、确认计划、原生 SkillCall 关系及冻结子依赖共同授权执行和取消。确定性接收在同一事务关闭准备尝试，避免自然语言恢复队列抢占。确定性子调用仍计费及计 MCP 次数，不预留模型调用；其他调用沿用原预算策略。

检查适配器只向 Provider 传 resourceId 与 area；TaskExecution 的 scheduledAt 锚定当前可执行时间，maxElapsed 取父期限剩余值与 300 秒中的较小值。确认等待消耗预算；过期输入拒绝，不能通过重放或重新锚定延长期限。连续子任务的人类确认保留同一持久 continuation 链头，后续外部等待递增版本。

巡逻以完成报告为 effect.patrol_reported。完整、降级及业务失败均保留规范报告；报告 status=failed 不宣称区域已巡逻成功。取消在既有 AgentTask output JSONB 中保留原生子任务汇总，Task 终态仍为 canceled，不能产生成功效果。Workflow 的错误 details 按 JSON 读取和保留，不更改冻结迁移。

当前、有效、逐对象摘要验证的实际导航轨迹是空间证据；无关业务对象缺失或事件历史重放缺口不否定该快照。至少两个真实位移点、区域内轨迹及有效检查覆盖仍是完整巡逻的必要条件。该证据不证明未提供的逐点时钟或完整设备历史。

Provider 的一秒可用性期限保持原值。确认后临派发边界重新读取可用性；若受治理控制检查以 READINESS_STALE 拒绝，只在消耗确认和发送 Provider 调用前刷新一次，并以同一 invocation/dispatch 身份重新授权。其他错误不重试；持续过期仍拒绝，且不会触发设备调用。

原生子流程的报告完成与物理证据完整性分别记录。检查报告为 degraded 时，后续 SkillCall 完成回调继续记录 degraded，禁止把已有降级终态升级为完成。失败报告从精确 Task/Resource/operation 的当前业务投影中恢复，包括 plain 和历史兼容 wrapped JSON 形式；其他任务及历史投影拒绝。

UGV 原生子任务的输入绑定适配仅在 ugv-agent-profile 中运行。通用运行模式沿用其既有 Skill 编译与 MCP 控制权限门禁，不能把同名 move_to@1 错当已治理 UGV 子任务；未授权物理调用仍以 MCP_CONTROL_AUTHORITY_REQUIRED 拒绝。全套和规范证据所选子集分别执行，避免全局 Skill 版本变化掩盖初始版本分支。

## Evidence

EP-INSPECTION-AREA-V1 与 reports/inspection-area-v1 固定两仓库源码、原始命令、退出码和日志哈希。policy-02、原生可用性刷新单元回归、retention-02 和八场景 joint-60 验证上述边界。joint-60 同时验证治理重复发布、每次两个独立子 Task 与各自唯一远端接入、失败发现保留及取消轨迹。早期 debug 回执仅作为单场景诊断，不能替代完整联合验收。冻结资产 165 项哈希未变；全门禁、部署和现场状态以最终验收记录为准。

本地原生升级发现既有 Binding 仅允许 Provider 身份变化的 CAS rebind，导致同一 Provider 的真实工具目录升级无法选取新的 Registry 谱系。现有命令与冻结 Schema 保持不变：先校验 expectedRevision 与精确当前 Candidate，再执行只读目录发现；同一 Provider 仅在目录 checksum 确实变化时创建后继绑定版本。只有观察计数或目录 revision 变化、checksum 不变时继续拒绝，不制造语义版本。反向用例使用真正未变的目录 checksum，保留无持久变更及旧绑定完整断言；正向用例验证身份、凭据引用、CAS 与新谱系。
