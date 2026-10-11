# Codex 总执行入口：SDAR ↔ 已部署 SMPP UGV v1.3 受管业务闭环

你正在修改 `zhouwen-giser/skill-driven-agent-runtime`。目标是完成实现与可复现验证，不是重复写架构综述。

## 一、先读并建立计划

读取仓库 `AGENTS.md`、`PLANS.md`、当前需求基线、追踪矩阵、相关 accepted ADR 与活跃 ExecPlan；再读本包 `BASELINE.lock.json`、`CODE_MAP.md`、总 ExecPlan、contracts 五份设计和对应任务卡。本包拟新增内部字段不是 SMPP wire contract，也不是自动修改上位需求的授权。

不要覆盖原根目录指导文件。在仓库 `execplans/` 新建或接续唯一活跃 `EP-SDAR-SMPP-V13-BUSINESS-CLOSURE.md`。将本包放在 `taskpacks/sdar-smpp-v13/` 时，移入后的仓库 ExecPlan 中以该目录引用任务卡。保留仓库已有进度与历史报告。

先执行 W0。检查工作树、当前 HEAD、PR34 实际状态和已包含功能；不能直接 reset、checkout 覆盖修改或重复 cherry-pick。参考 SDAR HEAD `52f54a11a40380f7c73bd9da277d640e49bdfbf7`；参考 main `f94d0b98d140dd22514029ccdc34978209426940`；兼容 SMPP `0a4a7c36865d4c9920a4e65857c0903e9ef12533`。若 HEAD 已更新，记录差异并保留已有正确实现，而不是退回旧代码。

## 二、按四个可运行增量实施

批次一：W0 合同、治理、源时间字段与代码入口核定，复用已实现的 FrozenV1McpClient/SmppTaskBusinessClient/Registry read。

批次二：W1 业务绑定；W2 完整 Context/Artifact 同步、持久投影和 Skill/Agent 输入。复用 BusinessEventSubscriptionService/inbox，不另建每任务 SSE 或第二套状态机。

批次三：W3 复用 RemoteTaskInputService 与 governed-control。必须有真实权限检查、不可变意图、发送前持久记录、单发送者和结果核对；不能用永真 mutationAuthority。导航调整是运行中 Intervention，不等待 input_required。取消提示不等于取消 Task。

批次四：W4 完整轨迹/确认链/业务结果；W5 重启、冲突、回滚、GOWM 存储适配及正式入口隔离 E2E。现场验证仅在有单独目标和范围授权时执行，否则记录 NOT_RUN，不停住其余开发工作。

## 三、必须遵守的决定

- 身份来源为原持久 RemoteTaskBinding 与冻结 Authority Snapshot。不能由调用方传入任意 taskId 或猜测设备最新 Execution 来获得权限。
- TaskBusiness 和公共事件流以固定 upstream contract 为准；不发明 RPC、wire 字段、schema 枚举或 device SDK。
- 将 Provider 接收时间作为 sourceTime；保留 deviceReportedAt、sdarReceivedAt、投影时间及 timeBasis。字段缺失明确 gap。
- Context current state、原始事件证据和完整轨迹三者分开；summary 不等于完整历史。只有最新快照时不得声称历史完整。
- 事件 intake 的 durable cursor 与投影 processed cursor 分离。inbox+admitted 水位原子；projection+processed/消费标记原子。允许受控 at-least-once 投递和幂等应用，不宣称跨 HTTP/设备 exactly-once。
- 受理不等于应用；Task completed 不等于业务成功；unknown 不等于 normal/fault；估算视场不等于真实覆盖。
- 恢复已准入任务的读取、等待与精确核对，不自动重跑整个 workflow 或重新 tools/call。现有 approved continuation 不由本包另建执行机制。
- 取消、计划变更、权限撤销和过期必须在最终发送边界检查。不能承诺撤回已经发出的网络请求。
- 不修改 SMPP/设备/现场配置；不接管 Provider 内部自动锁定；保持发射禁用；不增加独立锁定或发射功能。
- 不新增认证体系、多租户、PMS-api/pms-web、独立数据库、SDK、第二运行时或大范围重构。开发模式不需要外部 Token，但内部控制授权仍然真实有效。
- 不通过放宽 schema、跳过测试、删除失败证据、延长事实新鲜度窗口或降低阈值来通过验收。

## 四、如何处理未知与阻塞

路径移动时先按 CODE_MAP 中符号定位。上位需求/ADR 存在冲突时记录决策与最小修改，不能默默修改基线。若缺少外部合同字段、真实现场权限或 GOWM 迁移权限，只阻塞相应能力，保留诊断，继续实现不依赖该缺口的工作。

必须交付真正从 Registry → Skill/Task → Adapter → 夹具服务 → 反馈 → 业务投影 → 原任务判定的隔离测试。不能以直接调用孤立 parser/client 的测试代替端到端。

## 五、验证与阶段报告

每个代码增量先跑最小相关测试；每个正式里程碑按仓库当前规则完成完整 gate。源于 accepted ADR 的验证规则变更需明确引用，不得以本包减免 AGENTS 要求。禁止测试触达生产/现场数据库或真实设备；使用现有隔离 PG/Redis 工具。

使用本包 `acceptance/CASE_MATRIX.md` 的 AC-001–AC-050，更新实现文件、测试名称、命令、源码 SHA、实际环境与证据路径。测试环境不可用时标 BLOCKED，并附已尝试方法；未授权现场项标 NOT_RUN，不标 PASS。

每批更新 ExecPlan 的 Progress、Discoveries、Decisions、Validation、Outcomes，以及仓库 PROJECT_STATUS、CHANGELOG、追踪矩阵。不得自动提交远端 PR、合并、推送或部署；需要这些操作时依用户明确授权执行。

最终输出：变更摘要、逐项需求状态、测试命令及结果、完整确认/轨迹证据样例、未完成项、迁移和回滚说明。保留原失败运行，不只报最终绿色。局部开发闭环可完成，但不得因此宣称全项目发布或现场业务验收已完成。
