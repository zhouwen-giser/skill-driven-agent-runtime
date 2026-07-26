# P09 Acceptance Matrix

| ID | 验收内容 |
|---|---|
| AC-P09-001 | P00 READY_FULL、P01～P08 Handoff 已验证 |
| AC-P09-002 | 只评估 active decision_rule |
| AC-P09-003 | Rule / Pointer / Tenant / Goal / Plan 重检 |
| AC-P09-004 | Policy / Catalog / Readiness / Kill Switch 重检 |
| AC-P09-005 | Evaluation Context 不可变 |
| AC-P09-006 | Rule DSL 严格类型 |
| AC-P09-007 | 无动态 eval / 任意代码执行 |
| AC-P09-008 | Operand 只来自允许来源 |
| AC-P09-009 | Operator 有 Null / Unknown / Bounds |
| AC-P09-010 | 三值逻辑正确 |
| AC-P09-011 | Unknown 不被当 True |
| AC-P09-012 | 相同输入产生相同 Result Hash |
| AC-P09-013 | Forbidden Condition 硬阻断 |
| AC-P09-014 | Authorization Missing 硬阻断 |
| AC-P09-015 | Safety Policy 覆盖 Rule |
| AC-P09-016 | Rule 可比 Policy 更保守但不能更宽松 |
| AC-P09-017 | Conflict Resolution 稳定 |
| AC-P09-018 | Deny 覆盖 Allow |
| AC-P09-019 | Confirm 覆盖 Advice |
| AC-P09-020 | Specificity / Priority 可解释 |
| AC-P09-021 | Ambiguous Conflict 回退/确认 |
| AC-P09-022 | Compatible Combination 有界 |
| AC-P09-023 | Rule 不修改 Goal / Criterion |
| AC-P09-024 | Rule 不扩大 Scope / Authorization |
| AC-P09-025 | 低风险参数建议不自动成为权威 |
| AC-P09-026 | Plan Patch Candidate 有严格边界 |
| AC-P09-027 | Human Gate 不被删除 |
| AC-P09-028 | Plan Patch 通过 Existing Validator |
| AC-P09-029 | Plan Patch 通过 Existing Planning Authority |
| AC-P09-030 | Rule 不建立第二 Planner / Policy Engine |
| AC-P09-031 | 正式 Handoff 前再次 Recheck |
| AC-P09-032 | Goal / Plan / Rule Hash CAS |
| AC-P09-033 | 重复 Evaluation / Handoff 幂等 |
| AC-P09-034 | Stale 结果丢弃 |
| AC-P09-035 | Rule 不创建 Attempt / Workflow |
| AC-P09-036 | Rule 不调用 Skill / MCP |
| AC-P09-037 | Rule 不写 Formal Outcome |
| AC-P09-038 | Usage / Formal Outcome 可关联 |
| AC-P09-039 | Usage 不复制 Outcome Authority |
| AC-P09-040 | Drift 只触发 Revalidation Signal |
| AC-P09-041 | 未实现 Fast Gateway |
| AC-P09-042 | 未修改正式 Request 入口 |
| AC-P09-043 | 未实现 Intent / Case / Model Runtime |
| AC-P09-044 | API / Console / A2A 不泄露敏感 Operand |
| AC-P09-045 | Full Verify 通过 |
| AC-P09-046 | G16 有完整提交和 Evidence |
| AC-P09-047 | 并发 / 安全 / 性能测试通过 |
| AC-P09-048 | 独立只读 Review 无未关闭 blocking/major |
| AC-P09-049 | Draft PR 未 Merge |
| AC-P09-050 | P10 Handoff 完整 |

AC-P09-001～050 全部通过后 P09 才完成。
