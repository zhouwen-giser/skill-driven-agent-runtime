# Interface Version Migration

目标 Registry：

```text
Shared Interface Registry V1.2
```

冻结 Schema Hash：

- ExperienceActivityRef V1.2: `c8fcce49423d402c5cc202b588cbf8687c0c2cf4c8cd2f3ee15b723512e287e0`
- ExperienceTraceEvent V1.2: `4bd9445b70c69e82956eb3edd8dbad570bc0e4333ab5cb1908a816ad4a8e6425`
- ProcessVariant V1.2: `eabdc0a2265c302b5da9cd456fed06e8396c933ce7fd5ae6a25b75fa73c0bd17`
- WorkflowPattern V1.2: `a81cd287ea6d035e1d668d4ea17d4987a9789a10a6ec0744f64d8065951d2e11`
- FusedPattern V1.2: `1b7ff0b11f3dfea8d54c6eab9850d98983f096cc70c3cf6fe42a731990c5ec11`
- GeneralizedPattern V1.2: `f8fef3280ed65cbd34a836ee1c0785dd1ddd747ef7cd1bd7cb93dc1a1523790a`
- CandidateStaticValidationResult V1.2: `1dfc155aafc2490dfb33e20efaaea8389f926923a627a6a20e7f2c482cef7edd`

必须更新：

- P03 Domain/Schema/Completion/Review/Handoff；
- P04 Domain/Schema/Completion/Review/Handoff；
- P05 consumes V1.2 and requires P04R；
- P13 Final Audit includes P04R；
- validate-all 区分 14 formal + 1 mandatory remediation + 1 optional。

完整 Registry SHA 在执行时更新全注册表后计算，不得伪造。
