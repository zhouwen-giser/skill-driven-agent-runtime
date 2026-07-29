# P12 Implementation Plan

## G21：Management API、Console 与 A2A Integration

### 1. Handoff Validator

校验 P01～P11 Query / Command / Evidence Port、Version、Feature Flag、Reason Code。

### 2. Exposure Inventory

建立：

- Public；
- User；
- Operator；
- Reviewer；
- Approver；
- Admin；
- Security；

字段清单与 Redaction。

### 3. RBAC / Tenant

实现统一 Middleware / Policy，不在每个 Controller 手写。

### 4. Management Query Service

聚合：

- Artifact；
- Version / Diff / Lineage；
- Validation / Shadow；
- Promotion / Approval / Activation；
- Runtime / Usage / Outcome；
- Case / Model；
- Drift / Audit。

只读查询不得执行业务写。

### 5. Management Command Service

Adapter 调用 P02/P06 正式 Command Port。

### 6. Controller / OpenAPI

实现 Schema、Pagination、Filter、Status、Error、ETag / Version。

### 7. Console Registry

真实 API 连接、筛选、分页、状态。

### 8. Console Detail / Diff / Lineage

按权限投影。

### 9. Console Validation / Shadow / Promotion

支持审查证据、Counterexample、Known Unknowns。

### 10. Console Governance

Approve / Reject / Activate / Revalidate / Deprecate / Rollback / Kill Switch。

每个操作：

- 权限；
- Reason；
- Expected Version；
- Idempotency；
- Confirm Dialog；
- Audit Result。

### 11. Console Runtime / Feedback

展示 Gateway、Rule、Template、Case、Model、Formal Handoff、Outcome、Cost、Drift。

### 12. A2A Capability

扩展安全 Capability Summary / Agent Card，不暴露内部数据。

### 13. A2A Input-required / Evidence

复用现有 Interaction / Task 状态。

### 14. SSE

从正式 Outbox 投影治理、运行、反馈事件。

### 15. Audit / Redaction

所有 Query / Command / Export / SSE / A2A 通过统一 Redaction Policy。

### 16. Security

测试 Auth、RBAC、Tenant、Actor Spoofing、IDOR、CSRF（适用时）、XSS、Injection、Sensitive Exposure。

### 17. Accessibility

Console 键盘、焦点、标签、对比度、错误提示。

### 18. Compatibility

Existing API / A2A / SSE 不破坏；Feature Flag Off 保持旧行为。

### 19. Tests / Evidence

完成 Unit、Contract、Integration、E2E、A2A TCK、OpenAPI、Console、Accessibility、Security、Performance 和只读 Review。
