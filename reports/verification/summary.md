# Verification Summary

- Status: **failed**
- Commit: `abc057c026cdd14533f12aaf7429f6367c966ef0`
- Started: 2026-08-02T23:29:30.379Z
- Finished: 2026-08-02T23:31:52.831Z
- Duration: 142452 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 140509 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 845 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | failed | 1095 ms |
