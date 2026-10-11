# 合同 03：受管写入、发送边界和精确恢复

本轮只适配非发射观察答复与导航调整；不接管 Provider 内部动作、不增加独立锁定和发射路径。参考 [S07、S09](../SOURCES.md)。

## 1. 一条控制授权链

复用 `RemoteTaskInputService`、原 control authority/confirmation 和持久化 sender。新增业务协调只携带类型化业务数据；不能提供可由客户端/模型设置的 authorize 回调。默认 development 无 Token 不等于控制权限为 true：服务器根据现有政策和可信入口解析身份及预授权，所有任务与能力约束仍要通过。

本地准备函数建议 `prepareBusinessMutation(bindingId, request)`；发送函数建议 `dispatchPreparedBusinessMutation(intentId)`；核对函数建议 `reconcileBusinessMutation(intentId)`。这是职责示意，优先扩展已有方法而不是强制新增三套 service。

## 2. 不可变本地意图

每条意图至少关联：原 Task/binding/Execution、业务请求/Intervention 精确 ref、操作、严格输入、内容摘要、Plan 与 capability/确认依据、模式、创建时间和当前发送状态。actor 来源为原可信任务/控制入口，不接受调用方填写 respondedBy。

规范化摘要覆盖完整会影响效果的身份、业务版本、operation 和 payload；使用仓库现有 canonical hashing。属性顺序变化不改变意义，数组顺序保留意义，undefined 与 absent 按原 schema 归一化。不将当前 health 时间、轮询时间或临时连接 headers 纳入导致重启变化的稳定命令内容。

授权的“一次性消费”、发送意图与 dispatch claim 按原控制授权事务实现。不能在 HTTP 成功之后才第一次记录“曾想发送”。某些记录已在外层时直接复用，不再存第二份互相矛盾的日志。

## 3. 本地状态映射

优先映射已有状态；若没有，可用下列**内部**概念描述，不向 SMPP 添加枚举：

| 阶段 | 含义 | 可做的动作 |
|---|---|---|
| prepared | 意图已保存，尚未取得发送权 | 重核权限/版本/确认，撤销或获取发送权 |
| dispatching | 原子取得一次发送权，网络结果可能未知 | 原发送者执行；崩溃后只能先核对 |
| accepted | 收到 Runtime 持久受理回执 | 等待业务事实，不当作应用成功 |
| confirmed | 对应请求/命令的效果有精确业务证据 | 更新结果、恢复原已准入 continuation |
| rejected | 明确未被接受/应用，且原因可靠 | 报告；需要新决策时重新走授权 |
| uncertain | 可能已执行但无法精确确认 | 只读核对；阻止冲突变更，不盲重发 |
| obsolete | 发送前已过期/取消/被后继取代 | 保留历史，禁止发送 |

不可简单把 lease 过期当成“上一发送者没发过”。失去租约的进程不能提交新结果；后继取得的是核对权，不是默认再次派发权。系统采用可恢复的 at-least-once 读取与幂等投影，不承诺对物理效果实现普适 exactly-once。

## 4. 最终发送边界

事务内或按既有串行门核对 Task 活动、binding/version、capability、确认有效且未被错误消费、业务请求未失效、当前没有已获优先权的取消及冲突未决命令。取得 durable dispatch claim 后再调用原 Registry transport。

这提供明确线性化顺序：取消先获得边界，则后续变更不发；命令先获得边界且已经发送，则只能记录在途状态并进入正式取消/核对。HTTP 与数据库不是分布式原子事务，不能写出“任何取消都保证设备绝不会执行”的假承诺。

现有 Goal patch 会使原计划/确认失效，本包保持其规则。Provider 的 effectivePlanRevision 是远端业务计划版本，不是允许原地改写 SDAR immutable Workflow 的许可。

## 5. RequiredInput

从原正式 input_required 事件/输入服务建立 link；Task 状态与 Context 请求对象互相核对。请求 ID/key/revision/subject/deadline/schema 均对得上，才能准备答复。Input scope 只限该 Task/Execution；不能因新请求文本一样就复用旧确认。

`tasks/update` 只发送合同允许的 `taskId` 与 `inputResponses` 等字段；expectedRequestRevision 等为本地预检/记录，不发到服务端。accept 才携带 content；decline/cancel 不附加 content。关闭提示与取消 Task 是两条独立控制链。

回执 complete 只设 accepted，后续读取请求/业务对象确认实际状态。答复 HTTP 超时后先读取原请求；公开 Input 没有等价导航 commandId 时不强套其幂等重试。缺少可证明的精确终态就保留 uncertain，并向原任务暴露待核对而非失败重启。

## 6. 导航 Intervention

只操作当前 available 的 navigation.adjust_plan，核对 intervention revision、effectivePlanRevision、validUntil 和当前 inputSchema。原导航 running 即可，不人为制造 input_required。变更发生在同一远端 Task，不能再发 vehicle_navigate 创建替代任务。

commandId 在首次准备时固定，内容不可变。受理回执中的 duplicate 表示合同级去重结果，不表示设备采用新路线。确认必须能够把自己的 commandId 与对应业务对象/应用结果联系起来，并读取新的有效计划/路线；仅看到任意计划版本上升不够。

版本冲突后刷新视图，重新评估计划和确认；不在旧 commandId 下改变 guard/payload。已发送但不确定时，先查询；只有当前固定合同明确支持同 ID 同内容重试、authority 仍适用且原记录可恢复时，才走已审查恢复分支。没有精确核对能力就记录缺口，不发明 command/status RPC。

## 7. 权限撤销、错误与日志

重试/核对权限与新控制派发权限分开审查，但不能以“恢复”为由绕过原 Registry 读取授权。保留上游 reasonCode，再附内部分类，不吞掉原失败。禁止记录凭据、密钥、完整私密模型思维；只记录决定摘要、理由类别和证据引用。
