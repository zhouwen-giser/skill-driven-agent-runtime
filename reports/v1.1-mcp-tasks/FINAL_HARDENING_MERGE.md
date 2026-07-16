# SDAR v1.1 — Hardening Merge Evidence

## Verified topology

| Check | Result | Evidence |
| --- | --- | --- |
| Required hardening tag exists | passed | `v1.0.13-bug-fixed` → `91cd58ddcff57acf3ed846914feafaff603c69f2` |
| Hardening is an ancestor of feature HEAD | passed | `git merge-base --is-ancestor v1.0.13-bug-fixed HEAD` exited 0 |
| Hardening is in `origin/main` | passed | `git merge-base --is-ancestor v1.0.13-bug-fixed origin/main` exited 0; `origin/main` contains the tag |
| Protected hardening merge is visible | passed | `origin/main` at `6584bf0`, message `Merge pull request #3 from zhouwen-giser/release/v1.0-hardening` |
| Feature publication state | pending | `origin/feature/v1.1-mcp-tasks` remains at `f97637b`; Phase 6 changes are uncommitted |
| Feature → main pull request | not created | Must use normal protected-branch PR flow after clean verification |
| `v1.1.0-rc.1` tag | not created | `git tag --list 'v1.1.0*'` returned no tag during this audit |

## Reproduce

```powershell
git fetch --tags origin
git show -s --format='%H %s' v1.0.13-bug-fixed
git merge-base --is-ancestor v1.0.13-bug-fixed HEAD
git merge-base --is-ancestor v1.0.13-bug-fixed origin/main
git branch -r --contains v1.0.13-bug-fixed
git ls-remote --heads origin feature/v1.1-mcp-tasks main release/v1.0-hardening
git tag --list 'v1.1.0*'
```

## Publication rule

Do not force-push, disable branch protection or tag an unverified dirty tree. The remaining path is: commit Phase 6 intentionally, rerun the exact clean-commit release gate, push the feature branch, open the feature-to-main PR, and create `v1.1.0-rc.1` only when its documented preconditions pass.
