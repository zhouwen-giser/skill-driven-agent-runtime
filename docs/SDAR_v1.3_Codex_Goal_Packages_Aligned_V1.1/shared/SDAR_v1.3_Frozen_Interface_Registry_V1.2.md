# SDAR v1.3 Shared Interface Registry V1.2

`registrySha256: 8aa828faf544b2cad3d3eb72bfc0935b02ba324a517de1563308862fc7d60dee`

V1.2 是 P04R 发布的不可变增量注册表。V1.1 文件保持原样，仍是 P00-P02 和未受影响合同的历史权威；读取 V1.2 时，先读取 V1.1，再用本增量中同名合同覆盖。

总包统计保持：

- `formalProductPackages = 14`
- `mandatoryRemediationPackages = 1`（P04R）
- `optionalPostReleasePackages = 1`（P14）
- 顺序为 `P04 -> P04R -> P05`
- P04R 不创建 G23

| 合同 | Owner | 版本 | Schema Hash |
|---|---|---:|---|
| ExperienceActivityRef | P03 | 1.2 | `c8fcce49423d402c5cc202b588cbf8687c0c2cf4c8cd2f3ee15b723512e287e0` |
| ExperienceTraceEvent | P03 | 1.2 | `4bd9445b70c69e82956eb3edd8dbad570bc0e4333ab5cb1908a816ad4a8e6425` |
| ProcessVariant | P03 | 1.2 | `eabdc0a2265c302b5da9cd456fed06e8396c933ce7fd5ae6a25b75fa73c0bd17` |
| WorkflowPattern | P03 | 1.2 | `a81cd287ea6d035e1d668d4ea17d4987a9789a10a6ec0744f64d8065951d2e11` |
| FusedPattern | P04 | 1.2 | `1b7ff0b11f3dfea8d54c6eab9850d98983f096cc70c3cf6fe42a731990c5ec11` |
| GeneralizedPattern | P04 | 1.2 | `f8fef3280ed65cbd34a836ee1c0785dd1ddd747ef7cd1bd7cb93dc1a1523790a` |
| CandidateStaticValidationResult | P04 | 1.2 | `1dfc155aafc2490dfb33e20efaaea8389f926923a627a6a20e7f2c482cef7edd` |

WorkflowPattern V1.2 的 dependency relation 为 `direct_follows | precedes | parallel | conditional`；`conditional` 必须携带受限 `ConditionExpression`。
