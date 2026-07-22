# 外部 Provider 依赖门禁

Provider Runtime 由独立项目开发。本文件只定义 SDAR Goal 需要等待的外部交付，不定义 Provider 开发任务。

## EXT-BE-SKELETON

### 用途

解除 G07 的阻断。

### 必须提供

- `io.sdar/businessEvents` Discovery Schema；
- Listen Request Schema；
- Acknowledged Notification Schema；
- Task/Resource Business Event Schema；
- Continuity Notification Schema；
- Related Tasks Query/Response Schema；
- Error Catalog；
- Frozen Header Fixtures；
- Valid/Invalid Fixtures；
- Event ID/JCS/Timestamp Golden Vectors；
- Profile Version 和 Baseline Hash；
- 资产来源 Commit SHA；
- Skeleton Review 通过结论。

### SDAR 验证

- 文件可解析；
- 与 V0.5.2 需求一致；
- Header/Method/Name 规则完整；
- Current/replayable_closed/Continuity/Relation 语义完整；
- 没有待实现方自由选择的 P0。

### 不满足时

G07 标记：

```text
blocked_external_dependency
```

G03～G06 继续。

---

## EXT-BE-RUNTIME-CANDIDATE

### 用途

解除 G10 真实 Interop 阻断。

### 必须提供

- 可启动 Provider Runtime Candidate；
- 精确 Commit SHA；
- Provider Component Conformance 报告；
- 启动/配置说明；
- 测试 Adapter/Source；
- Durable Source 场景；
- Mixed 或 Best-effort 场景；
- Task/Resource Event Fixture；
- Continuity/Rotation 场景；
- Relation Pagination 场景；
- 认证配置；
- 已知限制。

### SDAR 只允许

- 启动或连接该 Candidate；
- 调用 MCP/Business Events 接口；
- 收集日志；
- 报告 Provider Defect。

### SDAR 禁止

- 修改 Provider 源码；
- 修改 Provider Schema；
- 创建 Provider Commit/PR；
- 将 Provider Defect 临时绕过成 SDAR 非标准兼容。

### 发现 Provider Defect

创建：

```text
reports/v1.2.2-interop/provider-defect-<id>.md
```

必须包括：

- Provider Commit；
- 请求/响应；
- 预期合同；
- 实际行为；
- SDAR Client 行为；
- 可复现命令；
- 阻断范围。

然后继续所有非 Interop 工作。
