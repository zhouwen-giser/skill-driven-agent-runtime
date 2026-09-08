# D07 — Worker、恢复与缓存设备范围

共享数据库真正的风险不只是写入缺列，还包括后台循环读到另一台设备。逐项追踪所有实际运行循环，生成 `worker-scope-inventory.json`，记录查询、scope入口、claim token、过期条件、恢复方法及测试。

## 必须覆盖

|路径|范围来源|
|初始任务领取、计划准备、SkillGoal/TaskAttempt调度|实际Task归属，不能从共享Goal/模板推断|
|Remote Task Admission恢复|Intent关联Task及其设备|
|Remote polling / notification / input / cancel|Remote Binding的device、service和原authority snapshot|
|Workflow continuation、子Workflow恢复|对应instance/Task/Node Run身份|
|用户输入等待超时、取消协调、终态投影修复|原Task设备范围|
|业务事件订阅/收件箱/连续性评估|subscription绑定设备和smpp_service_key|
|Evidence/Artifact/临时Skill等后台处理|真实来源Task存在时沿其归属；共享目录按服务级工作处理|
|保留和清理|有设备归属的历史只在明确范围处理，见D09|

Task级循环传 `allowedDeviceIds` 并JOIN真实父链。不能只加SKIP LOCKED；不能用 `device_id IS NULL OR device_id=ANY(...)` 把非设备记录当任意设备工作。非设备通道沿既有配置显式启用和处理，不偷偷归为第一台车。

一个明确单设备进程可以只处理一个deviceId；双设备可以是两个进程，也可以是显式多设备Worker。两者使用同一Schema和同一正常Repository实现，禁止测试专用改表名隔离。

## 并发与接管

保持原生poll/continuation/admission claim token、version、过期时间和锁顺序。同一任务同时被两个Worker竞争时只能一个成功领取；过期后合法接管；旧token不能提交新结果。

服务级后台工作如果原本没有设备，应使用现有稳定服务级协调，不伪造deviceId，也不在每台车上重复运行同一个共享catalog更新任务。

所有恢复查询与更新都包含相同scope条件；先按全库claim再在业务层丢弃不属于自己的记录不是正确实现。

## Redis / BullMQ / 内存路径

数据库改造时同时核查现有queue、缓存、event subscriber和AsyncLocalStorage：
- 队列payload保留Task/Binding身份，出队时回读并核验设备，不依赖当前进程默认车。
- 不必为每设备新建Redis实例。复用既有前缀/队列，必要key加入设备或逻辑服务，但不改变全局UUID已提供的唯一性。
- 客户端会话和provider binding缓存不得把server别名相同的不同服务/资源混用。
- LLM/embedding client可以共享；含任务结果和上下文的缓存不得跨设备复用。
- 路径不再依赖request线程存在才能恢复deviceContext。

## 故障与取消

数据库短暂失败使用既有退避，不热循环，不fallback旧库。MCP响应已到但本地保存失败，按现有Admission/Idempotency流程恢复同一次操作，不用新key重新调用设备。

取消、暂停、恢复、输入提交均使用原Remote Binding身份。仅数据库存储关联失败不能触发远程取消，更不能把另台车的同号Task作为目标。
