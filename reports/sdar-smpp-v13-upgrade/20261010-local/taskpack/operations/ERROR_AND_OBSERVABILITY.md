# 错误归类与最小可观测性

优先复用已有 typed errors 与 reasonCode，不建立新的错误字典体系。以下为处理类别，不是擅自发布的公共枚举。

| 类别 | 本地处理 | 能否自动再发送变更 |
|---|---|---|
| 身份/authority/合同不符 | 拒绝，记录精确差异，保留原冻结依据 | 否 |
| 只读网络超时 | 有界退避、原 task/身份/游标重读 | 不涉及变更 |
| 不完整快照、hash 冲突 | 不发布完整视图；隔离坏数据并重新读取/报告 | 否 |
| cursor expired / stream reset | 正式重建快照、保留历史 gap | 否 |
| 输入过期/被替换 | 使旧本地意图失效，重新读取当前请求 | 只有新决策/新授权后 |
| 计划 revision 冲突 | 重读、重新决策，不改原命令内容 | 只有合法新意图后 |
| 明确服务端拒绝 | 原因分层记录，保持原 Task/Skill 事实 | 不自动盲重发 |
| 变更 HTTP 超时/发送者崩溃 | uncertain，恢复原命令精确核对 | 默认否；仅冻结合同已支持的同 ID 同内容恢复分支可例外 |
| Task 终态后迟到反馈 | 附加历史，不重新唤醒动作 | 否 |

最小日志字段：本地 task/binding/attempt、远端 task/execution、provider/resource、context/object revision、public stream/sequence、sourceTime/timeBasis、命令 ID（适用时）、intent hash、阶段/原因、证据引用。敏感内容只作脱敏摘要，不记录凭据或完整连接串。

指标沿已有 telemetry/logging 输出即可：同步成功/失败、inbox backlog、未解析引用、continuity gap、最后处理位置、命令 accepted/confirmed/uncertain、重复拒绝、核对次数和持续时间。名字依现有注册规范决定，不新增独立监控平台。

异常报告需区分 upstream/source 不足、授权未给、隔离环境故障、产品代码缺陷。完整运行结果保留初始失败；重跑只能追加，不覆盖。日志中只有“调用返回成功”不能支持 business confirmed 或物理成功。
