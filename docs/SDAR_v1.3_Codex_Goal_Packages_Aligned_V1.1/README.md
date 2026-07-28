# SDAR v1.3 Codex Goal Packages Aligned V1.1

本总包包含 P00～P13 共14个正式任务包的修复版、跨包接口注册表、执行矩阵、审计报告和机器校验脚本。

## 开始

```bash
node scripts/validate-all.mjs
```

## 关键结论

- 任务包结构：READY
- 接口/字段对齐：PASSED
- Goal 覆盖：G00～G22 PASSED
- 正式包计数：14 PASSED
- P14：EXCLUDED
- Base Registry V1.1 SHA-256：`d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`
- P04R Registry V1.2 delta SHA-256：`8aa828faf544b2cad3d3eb72bfc0935b02ba324a517de1563308862fc7d60dee`
- Package counts：14 formal + 1 mandatory remediation (P04R) + 1 optional post-release (P14)

实际执行时仍需遵守未来 v1.2.3-final 和前序包已合并的条件。
