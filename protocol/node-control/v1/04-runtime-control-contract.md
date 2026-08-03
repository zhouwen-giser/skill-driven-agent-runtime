# 04. Runtime Control 内部合同

## 冷启动

```text
Runtime local bootstrap
→ 读取本地 Active/LKG
→ 尝试 Control Backend Bootstrap
→ 获取更新 Revision
→ Stage/Validate
→ Apply
→ Ack
```

Control Backend 不可用时 Runtime 使用 LKG，不清空配置、不停止已有 Task。

## Revision Pull/Watch

- `latest` 是权威拉取；
- SSE Watch 只提供 Revision Hint；
- 断线后重新调用 latest；
- Runtime 可以拒绝 stale、incompatible、unsafe Revision；
- Runtime Ack 至少包括 applied、partially_applied、rejected、restart_required、stale、unavailable。

## 运行操作

Skill、Artifact、Capability Catalog、Agent Card、Task Control 和 Telemetry Export 均通过显式内部端点，不允许 Control Backend 写 Runtime 表。
