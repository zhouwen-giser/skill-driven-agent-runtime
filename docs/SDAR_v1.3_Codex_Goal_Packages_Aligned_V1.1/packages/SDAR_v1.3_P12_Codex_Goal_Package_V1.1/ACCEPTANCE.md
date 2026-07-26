# P12 Acceptance Matrix

| ID | 验收内容 |
|---|---|
| AC-P12-001 | P00 READY_FULL、P01～P11 Handoff 已验证 |
| AC-P12-002 | Management Query 只使用正式 Query Port |
| AC-P12-003 | Management Command 只使用正式 Command Port |
| AC-P12-004 | Controller 不复制业务规则 |
| AC-P12-005 | Console 不直接访问数据库 |
| AC-P12-006 | Authenticated Identity 不来自请求体 |
| AC-P12-007 | RBAC 矩阵完整 |
| AC-P12-008 | Tenant 隔离完整 |
| AC-P12-009 | Cross-tenant IDOR 被拒绝 |
| AC-P12-010 | Approval / Activation 分离 |
| AC-P12-011 | Expected Version / CAS 正确 |
| AC-P12-012 | Idempotency 正确 |
| AC-P12-013 | Reason / Audit 完整 |
| AC-P12-014 | Artifact List / Detail / Version 正确 |
| AC-P12-015 | Diff / Lineage 正确且按权限裁剪 |
| AC-P12-016 | Validation / Shadow / Counterexample 可查询 |
| AC-P12-017 | Promotion / Approval / Activation 可操作 |
| AC-P12-018 | Revalidation / Deprecation / Rollback / Kill Switch 可操作 |
| AC-P12-019 | Runtime Match / Rule / Template / Gateway 可查询 |
| AC-P12-020 | Case / Model Route / Cost 可查询 |
| AC-P12-021 | Usage / Outcome / Drift / Audit 可查询 |
| AC-P12-022 | Pagination / Filter / Sort 正确 |
| AC-P12-023 | Error / Status Code 一致 |
| AC-P12-024 | OpenAPI 完整且验证通过 |
| AC-P12-025 | Console 使用真实 API |
| AC-P12-026 | Console Registry / Detail / Diff 完整 |
| AC-P12-027 | Console Promotion Review 信息完整 |
| AC-P12-028 | Console 操作有权限/Reason/Version/确认 |
| AC-P12-029 | Console Runtime Timeline 可解释 |
| AC-P12-030 | Console Loading/Empty/Error/Permission 状态完整 |
| AC-P12-031 | Console Accessibility 通过 |
| AC-P12-032 | Public Capability Projection 有严格 Allowlist |
| AC-P12-033 | Candidate / Internal Rule / Model Route 不公开 |
| AC-P12-034 | Credential / Secret / Private Experience 不暴露 |
| AC-P12-035 | A2A Formal Task 状态语义不变 |
| AC-P12-036 | A2A Input-required 复用现有协议 |
| AC-P12-037 | A2A Artifact Evidence 安全 |
| AC-P12-038 | A2A MUST TCK 通过 |
| AC-P12-039 | SSE 来自正式 Outbox |
| AC-P12-040 | SSE Tenant/Auth/Redaction 正确 |
| AC-P12-041 | SSE Resume / Dedup / Backpressure 正确 |
| AC-P12-042 | SSE 断开不改变正式状态 |
| AC-P12-043 | 错误响应不泄露内部信息 |
| AC-P12-044 | XSS / Injection / Actor Spoofing 被拒绝 |
| AC-P12-045 | Feature Flag Off 保持兼容 |
| AC-P12-046 | 未重实现 P01～P11 |
| AC-P12-047 | 未自动 Approval / Activation |
| AC-P12-048 | 未修改正式 Goal / Plan / Outcome Authority |
| AC-P12-049 | Full Verify 通过 |
| AC-P12-050 | G21 有完整提交和 Evidence |
| AC-P12-051 | OpenAPI / Console / A2A / Security 测试通过 |
| AC-P12-052 | 独立只读 Review 无未关闭 blocking/major |
| AC-P12-053 | Draft PR 未 Merge |
| AC-P12-054 | P13 Handoff 完整 |

AC-P12-001～054 全部通过后 P12 才完成。
