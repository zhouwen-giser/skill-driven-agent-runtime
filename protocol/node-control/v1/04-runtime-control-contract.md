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

Skill、Artifact、Capability Catalog、Agent Card、Task Control 和 Evidence Export 均通过显式内部端点，不允许 Control Backend 写 Runtime 表。

## v1.4.1 Evidence Operations internal surface

私有 `/internal/v1/evidence-export/operations/*` 是 Control 到 Runtime 的唯一 Evidence recovery
路径，使用专用 Runtime service credential 和 closed schema。读取响应只包含 metadata。恢复请求
携带 Control operation ID、`sha256:<64 lowercase hex>` 幂等键 hash、principal actor、reason 和
request timestamp。

Runtime 校验 exact active export configuration，并在 Runtime PostgreSQL 中持久化幂等 Recovery
Run。record、精确 source-family/partition、Episode replay、dead-letter retry 与 coverage reconcile
均不得执行任意 SQL、重放业务命令或修改 Task terminal。响应可以是 `requested` 或 `running`；
只有 durable run 是终态成功/失败权威。
