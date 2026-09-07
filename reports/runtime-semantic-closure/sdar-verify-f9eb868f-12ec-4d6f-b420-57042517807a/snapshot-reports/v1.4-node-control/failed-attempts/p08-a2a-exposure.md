# P08 Failed Attempts

| Attempt | Failure | Root cause | Repair / disposition |
|---|---|---|---|
| first A2A TCK | `pip.__main__` missing | incomplete cached tool virtual environment | pinned launcher accepts the exact installed uv version and bootstraps pip only when needed |
| second A2A TCK | `_virtualenv` and `pytest.__main__` missing | incomplete cached TCK `.venv` | launcher health-checks pytest and rebuilds the temporary environment with pinned uv; rerun passed 74/161 |
| old local schema replay | Control migration checksum drift | modified uncommitted 0007 met an old test ledger | destructive schema/ledger shortcuts were rejected; new isolated Runtime and Control databases were created and migrated from zero |
| first aggregate Integration | 2 stale foundation assertions | expected latest Control migration was still 0006 | assertions now cover 0007 rollback/reapply; rerun passed 25 files / 138 tests |
| first full verify | integration `ETIMEDOUT` | 120-second child limit was below the observed 122.9-second loaded run | bounded limit raised to 240 seconds; full rerun passed in 482.1 seconds |
| timeout-fix format check | Prettier warning | launcher line wrap was not formatted before its first small commit | formatting committed immediately; complete verify format gate passed |

No failed attempt is represented as passing product evidence.
