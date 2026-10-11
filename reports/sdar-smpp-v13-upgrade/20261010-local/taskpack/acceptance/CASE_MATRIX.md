# 验收矩阵

以下均为待实现/待执行规格，初始状态全部为 `NOT_RUN`。一个 case 可实现为多个参数化测试，但不得删减断言。CI 既有记录不自动填入这些新 case 的 PASS。

| 编号 | 工作包 | 场景 | 验证层 |
|---|---|---|---|
| AC-001 | W0 | 冻结基线与后继分支识别 | offline |
| AC-002 | W0 | Schema 精确漂移报告 | contract |
| AC-003 | W0 | 公开身份和执行模式 | contract |
| AC-004 | W0 | 历史任务不被 successor 改写 | postgres |
| AC-005 | W0 | 基线时钟字段识别 | contract |
| AC-006 | W1 | 首次业务执行关联 | postgres |
| AC-007 | W1 | 跨 Task/Execution/资源隔离 | contract+postgres |
| AC-008 | W1 | 引用与内容完整性分离 | contract |
| AC-009 | W1 | 无能力 Provider 的兼容退化 | contract |
| AC-010 | W1 | 投影重启不派发 | postgres |
| AC-011 | W2 | 分页快照一致性 | contract |
| AC-012 | W2 | 同 Context revision 多事件 | contract+postgres |
| AC-013 | W2 | 双水位事务恢复 | postgres |
| AC-014 | W2 | 跨任务共享事件流 | contract |
| AC-015 | W2 | 流 reset 与历史缺口 | postgres |
| AC-016 | W2 | 事件背压与轮询兜底 | integration |
| AC-017 | W2 | Skill 实际消费投影 | integration |
| AC-018 | W2 | 业务状态不能绕过授权 | contract |
| AC-019 | W3 | 缺少真实 mutationAuthority | integration |
| AC-020 | W3 | 合法 RequiredInput 正式闭环 | integration |
| AC-021 | W3 | Input 过期与请求替换 | contract |
| AC-022 | W3 | Input cancel 不取消任务 | integration |
| AC-023 | W3 | wire 字段白名单 | contract |
| AC-024 | W3 | Input 响应丢失恢复 | postgres+integration |
| AC-025 | W3 | 运行中导航调整无需 input_required | integration |
| AC-026 | W3 | Intervention ack 与 applied 分离 | integration |
| AC-027 | W3 | 计划版本冲突 | contract |
| AC-028 | W3 | 命令去重与内容冲突 | postgres |
| AC-029 | W3 | 取消抢占发送竞争 | postgres+integration |
| AC-030 | W3 | 发送后崩溃与有限核对 | postgres |
| AC-031 | W4 | 协议 completed 但业务失败 | integration |
| AC-032 | W4 | 路线轨迹四类数据分离 | contract |
| AC-033 | W4 | 完整轨迹大对象 | contract |
| AC-034 | W4 | Provider 接收时间语义 | contract |
| AC-035 | W4 | 缺时间、逆序和重复样本 | contract |
| AC-036 | W4 | 估算视场与真实覆盖 | contract |
| AC-037 | W4 | 未知枚举与证据缺失 | contract |
| AC-038 | W4 | 确认链完整导出 | integration |
| AC-039 | W5 | 活动任务跨版本升级 | postgres+integration |
| AC-040 | W5 | 两进程租约与恢复 | postgres |
| AC-041 | W5 | finalized 后迟到事件 | integration |
| AC-042 | W5 | 受控完整导航路径 | isolated-e2e |
| AC-043 | W5 | 受控观察答复路径 | isolated-e2e |
| AC-044 | W5 | 回滚遇到不确定命令 | integration |
| AC-045 | W5 | 授权现场只读验证 | site_read |
| AC-046 | W5 | 授权现场业务验证 | site_write |
| AC-047 | W5 | 无现场授权也可开发收口 | offline |
| AC-048 | W5 | 安全配置与副作用审计 | integration |
| AC-049 | W5 | 正式门禁与历史失败保留 | local_gate |
| AC-050 | W5 | GOWM 正式存储边界 | postgres |

## AC-001 · 冻结基线与后继分支识别

**Given：** 已取得 SDAR main、PR34 与工作树身份。

**When：** 运行本地基线审计，并比较分支祖先及所需符号。

**Then：** 记录 SHA、干净/脏状态、沿用/已包含/需重基三种结论；不静默切换分支。

**禁止行为：** reset --hard、覆盖用户未提交修改、重复 cherry-pick。

**验证层：** `offline`；**证据：** baseline-audit, source-map；**状态：** `NOT_RUN`。

## AC-002 · Schema 精确漂移报告

**Given：** 固定旧 catalog 与只读获得的新 catalog 夹具。

**When：** 分别改变必填项、类型、枚举和扩展版本。

**Then：** 报告 JSON Pointer、旧值、新值及影响；受影响能力拒绝新派发。

**禁止行为：** 关闭 strict 校验、仅输出 hash 差异、把健康状态改为 ready。

**验证层：** `contract`；**证据：** schema-diff, zero-dispatch-counter；**状态：** `NOT_RUN`。

## AC-003 · 公开身份和执行模式

**Given：** vehicle:ugv、isr.vehicle.ugv.ugv、ugv:ugv 和 live 基线。

**When：** 提交只读请求并注入内部 ugv1、错误 Provider、错误 mode、live 携带 scene 等反例。

**Then：** 合法请求采用冻结身份；非法身份/模式在边界拒绝；live 不带 simulation-id。

**禁止行为：** 为绕过错误而替换资源 ID、把软件仿真推定为 protocol simulation。

**验证层：** `contract`；**证据：** wire-capture, error-code；**状态：** `NOT_RUN`。

## AC-004 · 历史任务不被 successor 改写

**Given：** 旧任务冻结 revision A，新 catalog revision B。

**When：** 执行隔离环境正式 successor，然后读取两类任务。

**Then：** 新任务用 B；旧任务继续引用 A 或显式报告权限/可用性阻塞。

**禁止行为：** 重写历史 snapshot、自动把旧任务迁到 B。

**验证层：** `postgres`；**证据：** authority-before-after, row-diff；**状态：** `NOT_RUN`。

## AC-005 · 基线时钟字段识别

**Given：** 固定 Provider 公共响应，含接收时间和设备原始时间，或明确缺少其中字段。

**When：** 完成字段路径和来源 basis 清单。

**Then：** 只有具备可信 Provider 接收来源的字段进入 sourceTime；缺失被记录为 gap。

**禁止行为：** 凭字段名 timestamp 就认定设备采样时间或用 SDAR now 填充。

**验证层：** `contract`；**证据：** time-field-map, source-provenance；**状态：** `NOT_RUN`。

## AC-006 · 首次业务执行关联

**Given：** 受管 RemoteTaskBinding 已存在且有原始授权快照。

**When：** 读取该精确任务的正式 Context，并持久化初次 Execution 关联。

**Then：** 核对 Provider/resource/task/operation；首次绑定使用受管任务查询与 CAS，不用设备最新任务推断。

**禁止行为：** 接受任意 taskId、自动认领未知任务。

**验证层：** `postgres`；**证据：** binding-row, context-identity；**状态：** `NOT_RUN`。

## AC-007 · 跨 Task/Execution/资源隔离

**Given：** 两个本地任务及两个远端 execution。

**When：** 混入另一个 execution 的 Context、Artifact 和输入对象。

**Then：** 全部拒绝污染；保留来源诊断；旧完整视图只可标历史。

**禁止行为：** 按 resourceId 相同就合并。

**验证层：** `contract+postgres`；**证据：** negative-matrix, unchanged-projection；**状态：** `NOT_RUN`。

## AC-008 · 引用与内容完整性分离

**Given：** 元数据可读但内容缺块、摘要不符或高版本内容未读。

**When：** 读取 Context/Artifact。

**Then：** 引用可记录；该内容为 unresolved/unavailable；未满足必需对象不能供结果成功判定。

**禁止行为：** 有 metadata 就标完整、用旧版本冒充新版本。

**验证层：** `contract`；**证据：** content-digest, projection-quality；**状态：** `NOT_RUN`。

## AC-009 · 无能力 Provider 的兼容退化

**Given：** 工具未发布 TaskBusiness extension。

**When：** 执行原只读或远端任务流程。

**Then：** 旧流程保持可用；业务扩展标 unsupported；需要该能力的 Skill 明确不可满足。

**禁止行为：** 硬调不存在的方法、将 unsupported 默认为 complete。

**验证层：** `contract`；**证据：** legacy-regression, capability-result；**状态：** `NOT_RUN`。

## AC-010 · 投影重启不派发

**Given：** 投影已持久化，任务仍在运行。

**When：** 进程重启后恢复关联与只读同步。

**Then：** 远端 Task ID、Execution 和派发计数不变；内存重建来自持久事实。

**禁止行为：** 重新 tools/call 或重新执行整个 LangGraph。

**验证层：** `postgres`；**证据：** restart-log, dispatch-count；**状态：** `NOT_RUN`。

## AC-011 · 分页快照一致性

**Given：** Context 多页且含 descriptor 分块。

**When：** 注入换 revision、换 resumeFrom、重复 cursor、缺页、错误 hash。

**Then：** 完整一致时一次发布；反例失败且不覆盖已提交完整快照。

**禁止行为：** 部分对象暴露为完整当前状态。

**验证层：** `contract`；**证据：** page-trace, projection-before-after；**状态：** `NOT_RUN`。

## AC-012 · 同 Context revision 多事件

**Given：** 两个不同 eventId/object revision 共享 Context revision。

**When：** 顺序或乱序投递并追加重复事件。

**Then：** 两个不同变化都有处理/证据记录；重复不重复副作用；快照通知允许去重。

**禁止行为：** 仅因 contextRevision 相同就丢弃后一个业务事件。

**验证层：** `contract+postgres`；**证据：** inbox-rows, object-revisions；**状态：** `NOT_RUN`。

## AC-013 · 双水位事务恢复

**Given：** 已有 admitted 与 processed 水位。

**When：** 分别在 inbox 提交前后、投影事务提交前后崩溃。

**Then：** resume 水位只覆盖已持久 inbox；processed 标记与投影原子提交；重放不重复应用。

**禁止行为：** 收到网络帧就先推进 processed、丢弃未投影 inbox。

**验证层：** `postgres`；**证据：** transaction-fault-matrix, watermarks；**状态：** `NOT_RUN`。

## AC-014 · 跨任务共享事件流

**Given：** 同授权流包含多个 task 及 resource 级事件。

**When：** 处理 task 事件与正式 relatedTasks 关联结果。

**Then：** 只更新已授权且身份匹配的绑定；资源事件只按正式关联投影。

**禁止行为：** 将整个流视为当前任务、按设备最新 task 猜测。

**验证层：** `contract`；**证据：** routing-trace, unrelated-task-unchanged；**状态：** `NOT_RUN`。

## AC-015 · 流 reset 与历史缺口

**Given：** 持久游标已过保留期或流 generation 改变。

**When：** 按标准 continuity/error 恢复。

**Then：** 重建完整当前快照，记录历史缺口；旧 generation 不覆盖新视图。

**禁止行为：** 自行构造游标、宣称历史完整。

**验证层：** `postgres`；**证据：** continuity-record, snapshot-resync；**状态：** `NOT_RUN`。

## AC-016 · 事件背压与轮询兜底

**Given：** 大量重复变化与一次短暂 SSE 故障。

**When：** 合并快照刷新并恢复原事件服务。

**Then：** 并发/内存有界；Task 状态查询仍工作；业务不完整时不作成功决策。

**禁止行为：** 每条遥测唤醒模型、另建每任务永久 SSE。

**验证层：** `integration`；**证据：** refresh-count, queue-depth, no-llm-on-telemetry；**状态：** `NOT_RUN`。

## AC-017 · Skill 实际消费投影

**Given：** 同一正式 Skill，先后两份不同业务视图。

**When：** 通过正常计划/执行入口运行可控模型夹具。

**Then：** 捕获的 Skill/判断器输入含精确引用与质量；输出随业务事实改变。

**禁止行为：** 仅日志打印 Context、测试直接调用孤立 parser 冒充端到端。

**验证层：** `integration`；**证据：** skill-input-capture, result-difference；**状态：** `NOT_RUN`。

## AC-018 · 业务状态不能绕过授权

**Given：** 事件文本或对象 properties 夹带新命令、URL 或伪授权。

**When：** 进入投影与模型上下文。

**Then：** 只按 schema 接收数据；候选仍经 capability/control 边界。

**禁止行为：** 执行 LLM 生成代码或把 Provider 文本作为系统指令。

**验证层：** `contract`；**证据：** untrusted-data-test, zero-dispatch-counter；**状态：** `NOT_RUN`。

## AC-019 · 缺少真实 mutationAuthority

**Given：** 服务已接入写入构造器但无真实治理 receipt。

**When：** 尝试回答或导航调整。

**Then：** 在网络发送前拒绝；写接口计数为零。

**禁止行为：** authorize 永真、development 模式自动放行所有控制。

**验证层：** `integration`；**证据：** authority-denial, wire-counter；**状态：** `NOT_RUN`。

## AC-020 · 合法 RequiredInput 正式闭环

**Given：** 同一 Task/Execution 的有效请求，匹配 subject/schema，确认允许。

**When：** 经既有输入服务提交非发射观察答复。

**Then：** 持久命令意图先于发送；ack 仅记 received；新对象证据确认后恢复原等待。

**禁止行为：** 新建 Task、直接绕过 RemoteTaskInputService、ack 直接等于成功。

**验证层：** `integration`；**证据：** input-link, command-journal, business-confirmation；**状态：** `NOT_RUN`。

## AC-021 · Input 过期与请求替换

**Given：** 答案准备后请求过期、subject 改变或请求被 supersede。

**When：** 到发送边界重新核对，并模拟服务端竞争拒绝。

**Then：** 旧回答拒绝/失效；重新读取当前请求；不自动移植原授权。

**禁止行为：** 盲增 revision、复制答案到新请求。

**验证层：** `contract`；**证据：** race-result, zero-or-original-send-count；**状态：** `NOT_RUN`。

## AC-022 · Input cancel 不取消任务

**Given：** 活动任务存在待答复提示。

**When：** 提交 input action=cancel；另独立测试 Task cancel。

**Then：** 两条链作用域不同；Task cancel 才进入正式任务取消链并等待终态。

**禁止行为：** 关闭提示即报告车辆已停止。

**验证层：** `integration`；**证据：** wire-methods, task-and-input-states；**状态：** `NOT_RUN`。

## AC-023 · wire 字段白名单

**Given：** 本地记录包含 actor、确认、expectedRequestRevision 等治理信息。

**When：** 序列化 tasks/update。

**Then：** 仅发送 frozen 合同允许的字段；输入内容只在 accept 出现。

**禁止行为：** 发送 respondedBy/actorId/expectedRequestRevision 或新加 commandId。

**验证层：** `contract`；**证据：** exact-json-body, schema-pass；**状态：** `NOT_RUN`。

## AC-024 · Input 响应丢失恢复

**Given：** 远端已受理答复但 SDAR 未得到/未保存回执。

**When：** 重启并核对原请求对象及任务状态。

**Then：** 复用原本地意图，仅只读核对；不确定仍标 uncertain。

**禁止行为：** 为 Input 杜撰公开幂等接口、自动发送第二个不同答案。

**验证层：** `postgres+integration`；**证据：** crash-point, single-wire-update, uncertain-record；**状态：** `NOT_RUN`。

## AC-025 · 运行中导航调整无需 input_required

**Given：** 正常 running 导航任务有 available Intervention。

**When：** 通过正式控制路径提交调整。

**Then：** 原 Task ID 不变；校验两个 revision、inputSchema、有效期。

**禁止行为：** 创建新 vehicle_navigate、强制转换任务为 input_required。

**验证层：** `integration`；**证据：** same-task-id, intervention-command；**状态：** `NOT_RUN`。

## AC-026 · Intervention ack 与 applied 分离

**Given：** 收到 durablyAccepted=true/businessApplied=false。

**When：** 先只给 ack，再提供匹配命令的 applied 对象及已采用路线。

**Then：** ack 阶段不改采用路线；证据匹配后才更新有效路线。

**禁止行为：** 仅 Context revision 增加就断定自己的命令成功。

**验证层：** `integration`；**证据：** adoption-timeline, command-object-link；**状态：** `NOT_RUN`。

## AC-027 · 计划版本冲突

**Given：** 命令准备后 effectivePlanRevision 或 Intervention revision 改变。

**When：** 提交或服务端拒绝。

**Then：** 记录冲突、重新读取，重新决策与确认后才可能发新命令。

**禁止行为：** 同一 commandId 换 payload、盲调 revision 重试。

**验证层：** `contract`；**证据：** conflict-receipt, unchanged-journal-payload；**状态：** `NOT_RUN`。

## AC-028 · 命令去重与内容冲突

**Given：** 同 commandId 对应一个不可变规范化内容摘要。

**When：** 重复相同请求，再提交不同内容；并发两个发送者。

**Then：** 相同内容归并；不同内容拒绝；发送者只有一个持久 claim。

**禁止行为：** 生成新 ID 隐藏不确定结果、宣称网络端到端 exactly-once。

**验证层：** `postgres`；**证据：** unique-key-results, claim-lease, send-count；**状态：** `NOT_RUN`。

## AC-029 · 取消抢占发送竞争

**Given：** 调整意图已准备，同任务取消在最终发送锁前到达。

**When：** 在锁、确认消费、网络调用前后注入竞争。

**Then：** 若取消先取得发送边界，后续变更不发；若已发则进入在途核对并保留事实。

**禁止行为：** 声称能够撤回已到设备的包、取消后继续消费新动作候选。

**验证层：** `postgres+integration`；**证据：** ordered-boundary-log, send-count, inflight-state；**状态：** `NOT_RUN`。

## AC-030 · 发送后崩溃与有限核对

**Given：** 命令可能已发送，ack 尚未持久化。

**When：** 重启、多次核对、到达核对期限。

**Then：** 优先精确读取；到期保留 uncertain 和冲突阻塞；正式支持同 ID 重试时仍用同一字节与身份。

**禁止行为：** 把核对超时改成业务失败并重新派发、无界重试。

**验证层：** `postgres`；**证据：** reconciliation-attempts, payload-hash, no-new-command；**状态：** `NOT_RUN`。

## AC-031 · 协议 completed 但业务失败

**Given：** 远端 Task completed，结果携带业务失败/部分结果。

**When：** 运行 Skill 完成判断。

**Then：** 保留协议终态，业务结论为失败/部分/未知之一，符合原 Skill 合同。

**禁止行为：** Task completed 一律判业务成功。

**验证层：** `integration`；**证据：** protocol-vs-business-result；**状态：** `NOT_RUN`。

## AC-032 · 路线轨迹四类数据分离

**Given：** 请求点、规划线、采用路线与实际观测轨迹不同。

**When：** 解析、投影、对外导出。

**Then：** 四者分别保留类型、版本与来源；实际轨迹保留样本、时间和缺口。

**禁止行为：** 起终点直线冒充规划路线、跨未知 gap 连线冒充观测。

**验证层：** `contract`；**证据：** geometry-role-map, trajectory-samples；**状态：** `NOT_RUN`。

## AC-033 · 完整轨迹大对象

**Given：** 轨迹跨多个内容块，样本总数/摘要已知。

**When：** 读取并核验完整内容；模型仅拿摘要和引用。

**Then：** 无静默截断；超出限制明确 incomplete；原精确内容可追溯。

**禁止行为：** 为减少上下文而把完整证据压成最后一个点。

**验证层：** `contract`；**证据：** sample-count, sha256, content-ref；**状态：** `NOT_RUN`。

## AC-034 · Provider 接收时间语义

**Given：** 设备时间、Provider 接收时间、SDAR 接收时间均不同。

**When：** 投影、轨迹排序与 evidence 输出。

**Then：** sourceTime 等于公开合同可信的 Provider 接收时间；deviceReportedAt/sdarReceivedAt 保留。

**禁止行为：** 用设备时间或 SDAR now 替换 sourceTime、抹掉 timeBasis。

**验证层：** `contract`；**证据：** time-triplet, time-basis；**状态：** `NOT_RUN`。

## AC-035 · 缺时间、逆序和重复样本

**Given：** 部分样本无 Provider 接收时间，有迟到、相同时刻与重复样本。

**When：** 建立轨迹和排序视图。

**Then：** 原数据保留；缺时间明确 gap；稳定排序依据单独记录；没有人造采样时间。

**禁止行为：** 补零、线性插值时间、倒序覆盖新状态。

**验证层：** `contract`；**证据：** raw-preservation, ordering-policy；**状态：** `NOT_RUN`。

## AC-036 · 估算视场与真实覆盖

**Given：** 带 estimated 标志的扇形及过期时间，另有实际覆盖证据。

**When：** 投影和到期刷新。

**Then：** 二者分别解释；估算过期不再当当前覆盖，保留历史。

**禁止行为：** 估算扇形宣称设备真实完成覆盖。

**验证层：** `contract`；**证据：** quality-flags, expiry-case；**状态：** `NOT_RUN`。

## AC-037 · 未知枚举与证据缺失

**Given：** businessSemantics 标准 unknown、native 新原码或缺关键对象。

**When：** 解析并进行业务判定。

**Then：** 标准未知保持 unknown；原码保留；无关键证据不能判成功。

**禁止行为：** unknown 变 normal 或 fault、为结果完整填假值。

**验证层：** `contract`；**证据：** semantic-view, judge-output；**状态：** `NOT_RUN`。

## AC-038 · 确认链完整导出

**Given：** 命令意图、治理授权、发送、ack、业务对象和终态证据存在。

**When：** 通过既有 evidence/任务结果接口导出。

**Then：** 节点有原 ID、hash、因果链接与证据级别；缺链可见，不记录私密思维或凭据。

**禁止行为：** 按时间相近猜匹配、用同一个 success 混写多个层次。

**验证层：** `integration`；**证据：** evidence-chain, redaction-test；**状态：** `NOT_RUN`。

## AC-039 · 活动任务跨版本升级

**Given：** 历史无投影任务和新投影任务共存。

**When：** 执行增量迁移、恢复只读、再运行旧版兼容检查。

**Then：** 不重写旧 authority、不制造假业务视图；新字段缺省行为明确。

**禁止行为：** drop 业务表、重置 DB、把旧任务自动改用新 Provider。

**验证层：** `postgres+integration`；**证据：** migration-before-after, legacy-read；**状态：** `NOT_RUN`。

## AC-040 · 两进程租约与恢复

**Given：** 两个工作者竞争同一任务投影/命令处理。

**When：** 租约过期、旧工作者迟到写回、CAS 冲突。

**Then：** fencing/CAS 拒绝陈旧写；一个有效发送所有者；按现有恢复语义核对。

**禁止行为：** 进程内 mutex 冒充跨进程一致性。

**验证层：** `postgres`；**证据：** claim-tokens, stale-write-denial；**状态：** `NOT_RUN`。

## AC-041 · finalized 后迟到事件

**Given：** Task 已终态、Context 已 finalized 或正在终态收敛。

**When：** 投递迟到对象与 input/action 事件。

**Then：** 可补证据，不重新激活任务或生成新的控制。

**禁止行为：** 业务事件复活终态 Task。

**验证层：** `integration`；**证据：** terminal-before-after, zero-new-dispatch；**状态：** `NOT_RUN`。

## AC-042 · 受控完整导航路径

**Given：** 正式 Registry/Skill/Task 入口、隔离 SMPP 线协议夹具、可控模型。

**When：** 执行导航→Context→运行中调整→adopted→终态证据。

**Then：** 同一远端 Task、原执行权威、完整确认链；不直调测试内部服务绕过流程。

**禁止行为：** 把 parser 单测称全链路、访问现场设备。

**验证层：** `isolated-e2e`；**证据：** a2a-or-task-entry, full-call-trace, asserted-task-count；**状态：** `NOT_RUN`。

## AC-043 · 受控观察答复路径

**Given：** 既有观察任务和非发射 RequiredInput，Provider 内部动作作为外部事实。

**When：** 消费请求→正式输入服务→授权答复→业务确认。

**Then：** 不重复设备内部动作；只回答当前请求；同任务继续/结束有证据。

**禁止行为：** 接管自动锁定、独立下发锁定/发射。

**验证层：** `isolated-e2e`；**证据：** formal-input-entry, no-prohibited-methods；**状态：** `NOT_RUN`。

## AC-044 · 回滚遇到不确定命令

**Given：** 新版本有 pending/uncertain 业务命令，旧版本不支持。

**When：** 执行回滚预检。

**Then：** 拒绝让旧版本接管写入；提供只读排障/先核对方案；数据不删除。

**禁止行为：** 旧版本自动继续派发、删除命令行冒充安全回滚。

**验证层：** `integration`；**证据：** rollback-precheck, retained-journal；**状态：** `NOT_RUN`。

## AC-045 · 授权现场只读验证

**Given：** 用户另行授权明确目标，已冻结脱敏现场清单。

**When：** 运行已审阅的只读合同和已有任务读取。

**Then：** 记录真实镜像/合同/模式、读取证据和设备变更调用为零；不可达标 BLOCKED。

**禁止行为：** 对新建任务或写接口进行探测。

**验证层：** `site_read`；**证据：** site-read-authorization, readonly-captures；**状态：** `NOT_RUN`。

## AC-046 · 授权现场业务验证

**Given：** 用户另行授权具体非武器任务/设备/时间窗/停止条件，前置门禁通过。

**When：** 运行有限导航调整或非发射观察答复验收。

**Then：** 真实确认链、结束/停止事实和唯一派发计数齐全；只覆盖授权范围。

**禁止行为：** 自动启动任务、发射、独立锁定、超授权操作。

**验证层：** `site_write`；**证据：** site-write-authorization, actual-evidence, cleanup-state；**状态：** `NOT_RUN`。

## AC-047 · 无现场授权也可开发收口

**Given：** 本地实现及隔离测试可完成，但未授权现场操作。

**When：** 生成交付报告。

**Then：** 分别记录 local 开发结果和 site NOT_RUN；不中断其他可完成工作。

**禁止行为：** 反复索要确认、伪造现场 PASS、把未授权写当执行失败。

**验证层：** `offline`；**证据：** final-closeout, layered-status；**状态：** `NOT_RUN`。

## AC-048 · 安全配置与副作用审计

**Given：** development/live 默认，明确禁用发射及直连设备。

**When：** 遍历允许执行路径、错误和恢复路径。

**Then：** 禁用项始终不发；继承用户显式 NO；无 simulator/site 配置变更。

**禁止行为：** 将本任务包授权扩大到服务器重启、调整模型或开启禁用功能。

**验证层：** `integration`；**证据：** denied-tool-counters, config-diff；**状态：** `NOT_RUN`。

## AC-049 · 正式门禁与历史失败保留

**Given：** 当前修复后的同一源码 SHA，独立 PG/Redis。

**When：** 执行仓库要求的完整里程碑门禁。

**Then：** 命令/exit code/源码 hash/依赖身份可复现；原失败保留，不放宽断言。

**禁止行为：** 删除失败报告、降低阈值、只跑专项测试即称全面通过。

**验证层：** `local_gate`；**证据：** gate-results, source-hash, failed-run-archive；**状态：** `NOT_RUN`。

## AC-050 · GOWM 正式存储边界

**Given：** 启用已选 GOWM 接入合同，原角色/设备作用域已配置。

**When：** 验证新增读模型/命令持久化与恢复。

**Then：** 仅通过已准入 SDAR 持久接口写自有数据；只读 SMPP 业务源；权限不足明确阻塞。

**禁止行为：** 直接修改 ugv_smpp 私有表、绕过 owner 迁移、另建业务数据库。

**验证层：** `postgres`；**证据：** role-permissions, writer-inventory, gowm-gate；**状态：** `NOT_RUN`。
