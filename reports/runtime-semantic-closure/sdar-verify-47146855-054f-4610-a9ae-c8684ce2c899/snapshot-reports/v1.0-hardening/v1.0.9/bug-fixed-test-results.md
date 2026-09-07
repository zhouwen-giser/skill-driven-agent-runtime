# v1.0.9 Bug-fixed Test Results

Date: 2026-07-16

Required command:

```text
SDAR_REUSE_EXISTING_INFRA=true PNPM_CONFIG_STORE_DIR=/home/zhouwen/snap/code/248/.local/share/pnpm/store/v11 pnpm verify
```

Result: passed in 87,491 ms.

- Static/bootstrap: format, ESLint, strict TypeScript, 61 unit/contract files and 332 tests passed (273 unit + 59 contract).
- Architecture: 181 TypeScript source files.
- A2A baseline: 74/74 applicable must tests passed; 161 documented skips; 235 total TCK cases.
- Management OpenAPI: 104 operations.
- Acceptance: 18 evidence-classified scenarios.
- Source pins, Apache-2.0 project license and SBOM for 288 npm packages plus 2 external services: passed.
- Production Server and Console builds: passed.
- Empty and historical-0049 migration paths through 0062: passed.
- Real PostgreSQL/Redis integration: 2 files, 58 tests.
- Real A2A/Model/MCP E2E: 1 file, 46 tests.
- Infrastructure smoke and Server/Console smoke: passed.
- Regression additions cover disconnected/duplicate authority, persistence corruption, relation fanout, JSON depth and bounded indexed graph reads.
- Infrastructure mode: operator-managed; Compose daemon/config deferred; no Docker command ran.
