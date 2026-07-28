# Activity Identity V1.2

```text
eventType = 生命周期事实
activity = 业务/规划/能力层作业身份
```

Process Mining 只能使用 `event.activity.activityKey` 作为流程节点。

Activity 必须包含：

- activityKey；
- activityKind；
- objectiveSummary；
- Plan Node / Skill Goal / Attempt / Operation 可追溯引用；
- capabilityRefs；
- effectRefs。

同一逻辑步骤的 Start/Complete/Failure 必须共享 Activity Key。纯 Goal/Plan 生命周期事件可无 Activity，且不得作为流程节点。Unknown Activity 必须降低完整度，不能静默推广。
