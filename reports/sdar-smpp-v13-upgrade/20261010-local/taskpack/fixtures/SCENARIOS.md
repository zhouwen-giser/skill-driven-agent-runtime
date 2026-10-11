# 确定性夹具与故障注入规格

本目录只提供夹具规格，不提供伪造的上游黄金响应。实现者从已存在、固定合同验证通过的适配测试构造真实 wire fixture；每份 fixture 标明来源提交、schema hash、mode、时钟和是否为 synthetic。

## 基础夹具

F01：合法 Provider/catalog，精确 provider/resource/live 身份，development 无凭据。F02：两个不同 task/execution 且共享设备。F03：分块 Context、精确 Artifact 以及共享 Context revision 的不同对象事件。F04：原 input_required link 与有效非发射答复 schema。F05：正常 running 导航及 available Intervention。F06：技术终态与业务失败/部分结果。F07：完整轨迹、缺时间样本、估算视场和缺口。F08：旧任务记录、历史 authority 与 GOWM owner/device scope。

所有 Task/Execution/request/command ID 为明显的 fixture 标识，不使用现场任务。固定时钟可选择 `2026-10-10T00:00:00.000Z`；测试自己的 ID/时间是合成数据，不得被报告为设备观测。字段结构必须来自现有 schema，不为测试方便加未发布字段。

## 必须实现的故障注入点

| 注入点 | 预期 |
|---|---|
| inbox 事务提交前/后 | 未提交可重取；已提交可恢复且不丢失 |
| Context 网络读取后、投影提交前 | 重新 CAS；取消/版本变化后不覆盖当前活动状态 |
| 投影与 processed 事务中 | 全部提交或全部回滚 |
| 确认消费/dispatch claim 前后 | 无真实授权零发送；崩溃后优先核对 |
| HTTP 已发、Runtime 已受理、ack 丢失 | 同意图 uncertain；不换 ID 重发 |
| ack 已读但结果未落库 | 核对原命令；不把确认消费第二次 |
| applied 事件先到/晚到/乱序 | 与原命令及 adopted route 关联，不按时间猜 |
| 取消与最后发送边界竞争 | 保留正确先后，不能声称撤销已发消息 |
| lease 过期后旧工作者返回 | fencing/CAS 拒绝陈旧提交 |
| stream reset / cursor expired | 当前快照可重建，历史缺口仍可见 |

## 两条隔离端到端路径

NAV：正式 Task/A2A 请求 → 真实 Registry/Skill/权限 → 夹具 SMPP 长任务 → 业务投影 → 正式导航调整入口 → Runtime ack → 对应 applied/采用路线 → 终态证据 → 原 Skill 结果。

OBS：已有或隔离创建的非武器观察任务 → 原事件/输入服务 → Context 与 request 一致性 → 正式用户答复与授权 → tasks/update → 新请求对象/业务确认 → 原任务继续/结束。Provider 内部动作仅作为输入事实，不由 SDAR 发出新的独立锁定控制。

模型用 deterministic fixture 证明编排与数据流，不能声称验证了真实模型泛化能力。真实模型或现场设备测试若另行执行，另列环境与结果，不能覆盖原 deterministic 失败。
