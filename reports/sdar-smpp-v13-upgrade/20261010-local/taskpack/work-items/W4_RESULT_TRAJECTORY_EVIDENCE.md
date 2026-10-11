# W4 · 业务结果、完整轨迹、源时间与确认链

## 目的

让结果能说明实际发生了什么，以及证据是否充分；完整轨迹和确认链可供原任务输出及评估使用。

## 前置条件

W2 投影和 W3 命令事实可供使用；时间字段与核心几何语义已从 W0/W2 开始落实，不能拖到收尾才修。

## 实际入口

ugv-business-projection、result-processing-service/outcome-judges、skill-evidence-matcher、skill-execution-recording、既有 evidence 注册/schema/输出与 artifact 存储。

路径状态与来源见 [CODE_MAP](../CODE_MAP.md)。拟新增名称仅为建议，存在等价入口时优先复用。

## 实施子任务

### W4.1 · 按 Skill 合同拆分终态结论

**实现步骤：** 分别保留协议 status、业务 outcome 和证据质量；失败保留原 reasonCode。对每个本轮 Skill 明确必需对象和证据，不用统一 completed→success 规则。

**可验收输出：** AC-031/037，completed 业务失败、缺证据和合法 unknown 的确定性判断。

### W4.2 · 完整轨迹与几何对象解析

**实现步骤：** 按精确版本读完所有块；区分请求点、规划线、采用线、实际轨迹、观察区域、覆盖和估算视场。模型上下文仅摘要；原样本/缺口/完整内容引用保留。

**可验收输出：** AC-032/033/036，样本数量、摘要和角色匹配；过期估算不当真实覆盖。

### W4.3 · 统一 Provider 源时间

**实现步骤：** 使用 W0 核定的可信接收时间路径；每个样本分别处理，不给历史样本复制外层 task 更新时间。保留 deviceReportedAt、sdarReceivedAt、timeBasis 与排序依据。

**可验收输出：** AC-034/035，缺字段、未来值、迟到、同时间和重放不改变原来源。

### W4.4 · 导出正式确认链和业务 Artifact

**实现步骤：** 沿既有 evidence registry 增量提供意图→确认→发送→ack→业务应用→执行证据→Skill outcome 链。关联必须有原 ID/hash；大内容引用既有存储；不得直写 GOWM/SMPP 私表。

**可验收输出：** AC-038，导出旧消费者兼容、敏感信息过滤、缺链可见与正式 schema/coverage 检查。

## 不可修改边界

不伪造轨迹时间、几何或设备确认；不把 prompt 摘要当原证据；不新增设备原码翻译表；不收集私密 chain-of-thought。

## 验证

执行 [验收矩阵](../acceptance/CASE_MATRIX.md) 的 **AC-031–AC-038**；将每个 case 绑定到真实测试文件/名称和报告。局部测试后，按仓库规则运行本批正式里程碑完整 gate，命令依据 [COMMANDS](../acceptance/COMMANDS.md)。不为本工作包杜撰不存在的 npm script。

## 完成标准

AC-031–038 通过；证据样例能复核完整轨迹、源时间与因果链；模型摘要和证据完整性各自有明确状态。

## 失败与恢复

上游没有完整轨迹或接收时间就标 partial/gap，返回已有真实内容；不得声称已获得完整历史，也不改设备端制造所需字段。

## 本批交付记录

复制 [阶段交接模板](../templates/STAGE_HANDOFF.md) 到该批报告目录；保留具体源码 SHA、代码差异、命令、exit code、测试环境与未执行项。更新总 ExecPlan 和追踪矩阵。本任务卡初始状态为 `NOT_STARTED`。
