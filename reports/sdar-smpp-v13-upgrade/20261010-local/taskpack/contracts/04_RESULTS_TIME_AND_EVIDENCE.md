# 合同 04：业务结果、完整轨迹、时间和确认链

## 1. 三层结果

协议结果回答“请求/任务的技术状态”；业务结果回答“具体 Skill 目标是否完成”；证据质量回答“结论可靠到何种程度”。三层分开持久化，按已发布 Skill 合同选取成功标准，不修改整个系统统一结果枚举。

Task completed 但业务 failure/partial/unknown 时，保留 completed 的协议事实，不宣称 Goal 成功。Task failed 时保留原 Provider 错误，不再套用仅适用于成功路径的位置证明而吞掉真实错误。accepted、applied、业务完成与物理证据是不同里程碑。

## 2. 图形与轨迹的角色

| 角色 | 使用的事实 | 不允许的替代 |
|---|---|---|
| 请求目标 | 原 Task/Skill 输入 | 改成设备最终位置 |
| 规划路线 | planner/Provider 明确返回的路线 Artifact | 起终点直线 |
| 采用路线 | 与当前有效计划及已应用命令有对应关系的版本 | 最新收到的任意路线 |
| 实际轨迹 | 该执行的完整观测样本及其来源 | 规划路线、无时间的点集、跨未知 gap 的平滑线 |
| 观察区域 | 原区域对象或正式采用区域 | 估算当前视场 |
| 真实覆盖 | Provider 明确声明的覆盖事实和质量 | 估算扇形 |
| 估算视场 | 带 estimated、有效时间及来源的形状 | 已完成可见覆盖结论 |

轨迹记录保留样本原标识/顺序、坐标参考、时间、有效性和缺口；原始字段不具备时不能补造。WGS84 形状使用合同规定的经纬顺序；其他坐标系只在有显式转换参数和出处时转换，不猜测 EPSG 或轴向。

完整内容读取必须验证精确 Artifact revision、分块偏移、长度和 hash。摘要与展示抽稀是派生结果，必须标明抽稀并引用完整内容；禁止把抽稀结果作为原始证据。达到现有内存/分页上限应标 incomplete，可通过已有 artifact 存储的流式读取方式改进，但不能解除限制无限缓存。

## 3. 源时间规则（用户决定 U01）

`canonical sourceTime = UGV Provider 对对应观测/事件的接收时间`，不是设备自报时间，也不是 SDAR 获取快照的时间。

内部示意字段：

| 字段 | 来源 |
|---|---|
| sourceTime | 冻结公共合同中，具备 Provider 接收来源证据的值 |
| sourceTimeBasis | `provider_received_at`；内部语义，不擅改外部字段 |
| sourceTimeFieldPath | W0 核定的原字段路径/authority 依据 |
| deviceReportedAt | 可用时保留设备原始时间，不参与覆盖 sourceTime |
| sdarReceivedAt | SDAR 接收该数据的真实时间 |
| projectedAt | 读模型实际提交时间 |

不能把外层任务更新时间赋给内层每个历史轨迹样本；单个样本没有 Provider 接收时间时该样本 sourceTime 缺失，轨迹时间完整性下降。公开 stream sequence 用于恢复和稳定事件排序，sourceTime 用于业务时间解释，两者不可互换。

同时间戳按原序号/样本 ID 稳定排序；迟到数据保留原时刻和到达顺序。对时钟漂移、未来值、缺失及反序，记录时间质量，不为了让测试通过而放宽既有新鲜度门槛。时区按带 offset 的时间解析；存储/输出沿用仓库标准，避免无时区字符串。

## 4. 标准语义

消费 `ugv.business-semantics/1`，保留 `native`，不在 SDAR 第二次维护设备原码翻译表。合法标准 unknown 原样保留，未知原码不被解释为正常或故障。若 wire 标准枚举本身出现未发布值，按合同漂移处理，不通过开放 string 忽略错误。

不完整状态不必阻塞所有展示；只阻塞依赖其证据的自动成功判定或变更。规则需明确列出每个 Skill 的必需对象和最小证据，而不是用一个全局 complete=false 把无关只读能力全部关掉。

## 5. 完整确认链

最小链条：`本地意图 → 用户/政策确认依据 → 权限消费/dispatch claim → 原始发送身份与 payload hash → Runtime ack → 对应业务对象结果 → 采用 Artifact 或执行观测 → Skill outcome`。

每一条边使用真实 ID/hash/明确关联字段，不按“时间很近”猜测。某一段不提供完整证明时，可返回其余已知事实和 `gap`，不能补造关联或把 Provider 收到消息当作设备确认。设备确认是否可获取由冻结公共合同决定，本轮不直连设备补取。

复用原 evidence 输出和 task artifact。新增 evidence record 类型时按现有 registry/schema/coverage/handoff 流程增量变更，并保持旧消费者兼容；不能只在日志加一条 JSON 自称正式证据。完整 raw 内容可以引用既有不可变内容存储，不重复写入模型 prompt 或每条事件。

## 6. Agent 可见内容与内部审计

Agent 看到摘要、当前合法候选和证据质量；历史完整内容按需经同一受管读取入口获取。审计保留决策摘要和确认事实，不保存或要求私密 chain-of-thought。Task 结果对外展示路线、区域、轨迹和待输入时沿用现有 Task/A2A Artifact 能力，本轮不建设新控制台。
