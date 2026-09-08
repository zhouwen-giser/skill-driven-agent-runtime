## Summary
SDAR正常运行路径接入GOWM固定共享ugv_sdar，以device_id管理设备业务。

## Changes
- Shared storage configuration and verify-only startup.
- Task/Admission/Workflow/Target/Remote Binding device ownership.
- Canonical MCP identity reconciliation without cross-service writes.
- Device-scoped recovery, subscriptions, evidence and retention.

## Verification
填实际命令与测试结果，区分真实PostgreSQL、MCP fixture和真实SMPP。

## Parallel boundary
Only skill-driven-agent-runtime modified. No GOWM/SMPP source changes. No runtime writes to ugv_smpp or Mission records. No wait for SMPP branch completion.

## Limitations
No old-data migration, production switch, physical device qualification, or full multi-repository E2E claim.

Draft only. No automatic merge, tag, release or deployment.
