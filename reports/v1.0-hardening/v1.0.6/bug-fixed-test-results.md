# v1.0.6 Bug-fixed Test Results

Date: 2026-07-16

Complete command:

```text
PNPM_CONFIG_STORE_DIR=/home/zhouwen/snap/code/248/.local/share/pnpm/store/v11 \
SDAR_REUSE_EXISTING_INFRA=true pnpm verify
```

Result: passed in 82,005 ms.

- Static/unit/contract/build stage: passed; 243 unit and 58 contract tests.
- Empty and historical-0049 migration paths through 0058: passed.
- Real PostgreSQL/Redis integration: 2 files, 53 tests passed.
- Real PostgreSQL/Redis/Model/MCP E2E: 1 file, 44 tests passed.
- Architecture: 175 TypeScript source files passed.
- Infrastructure smoke and Server/production Console smoke: passed.
- A2A baseline, management OpenAPI, acceptance map, source pins, Compose static policy, project license and SBOM gates: passed.
- Verification report: `reports/verification/summary.{json,md}`.
- Infrastructure mode: operator-managed; no Docker command ran.
