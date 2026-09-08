# D03 — 设备上下文与业务归属

## 内部上下文（不是新增公开A2A/MCP字段）

```ts
interface DeviceTaskContext {
  deviceId: string;
  dataScopeKey: string;
  bindingId: string;
  sdarServiceKey: string;
  smppServiceKey: string;
  providerId: string;
  resourceId: string;
  sdarMcpServerId?: string;
  agentProfileId?: string;
}
```

上下文来自部署明确设备绑定、已有结构化入口和GOWM设备目录校验，不来自LLM随意补字段，不按车辆名称/坐标/数组顺序猜测。不另起鉴权平台；复用已有可信请求上下文与数据scope。

设备字符串 `ugv1` 是外部identifier，未必是内部device_id。必须查设备主档并使用真实稳定ID。Agent profile、Resource ID与deviceId不可混用。

## 创建与恢复

任务接纳之前确定归属；设备Task创建一次写入 `device_id / gowm_binding_id / sdar_service_key`，非设备Task三者均NULL。禁止先创建NULL Task后用UPDATE补设备，现有不可变约束不允许这种模式。

运行时恢复、用户输入、确认、取消、结果查询从已保存Task恢复device/service/binding上下文，并校验允许范围。不要按当前设备主绑定重新解释旧任务；服务/资源路由发生变化时遵守既有binding/currentness规则，不能静默切向另一台设备。

保留历史绑定ID与现有MCP authority snapshot。已创建远端Task的查询/取消继续使用其原协议源身份，不修改endpoint/resource使其控制新设备。

## 所有者分类

|类别|处理|
|设备Task、实例、Invocation和Remote Binding|按实际DDL显式写设备，保持父子一致|
|子记录无独立device列|按真实父Task/Binding/Subscription FK链过滤，不临时加列|
|Goal / user_goal_plan / skill_goal / Skill / Workflow模板|允许跨设备复用定义，不依据第一个消费者锁死设备|
|非设备Task|保留显式NULL业务分支，NULL不是全设备通配符|
|没有硬Task FK的来源记录|按GOWM新增字段写device并校验已有父Task；异步/历史合法无父场景仍保留|

设备A、B可以引用同一个共享Goal或Skill。各自生成的Workflow执行Plan和Instance必须能归属各自Task，不能把一个已属A的workflow_plan改成B。

## 请求级与进程级隔离

支持两种简单部署：一个进程明确负责一台车；或一个进程明确负责配置设备集合。两者同Schema。进程级单车选项不允许作为数据库全局DEFAULT。

缓存键检查：执行上下文、Remote Binding查找、MCP会话/凭据路由、待确认Task、模型输入缓存/快通道结果、事件订阅不能按进程单例误共享。纯共享Skill定义缓存可以共享；含业务结果的缓存要包含真实设备/Task/版本。

A2A contextId可以承载多设备对话，不把conversation_context强行绑定成单车；每个Task单独检查设备。禁止“同一个对话所以可以看到另一设备全部Task”。

异步子Workflow、Skill调用、Retry和Continuation必须继承对应父执行的设备上下文，不能依靠请求线程仍存在。
