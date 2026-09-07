# SDAR v1.4 Release Rollback

Before merge, rollback is branch-only: close the PR or add a forward repair commit. Do not rewrite
published phase history.

After merge but before governance traffic, stop the candidate, restore the pre-upgrade Control dump
into a new database, verify migration ledger/hash/Node identity/active pointers and repoint only
through the deployment control plane. Runtime continues on its independent Active/LKG state.

After new immutable revisions or events are accepted, do not run destructive down migrations.
Publish compensating revisions or roll forward with a corrected release. The detailed operator
procedure is `docs/operations/v14-node-control-upgrade-rollback.md`.

This Goal does not authorize tag, GitHub Release or deployment actions.
