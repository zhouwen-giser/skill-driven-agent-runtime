# SDAR v1.1 — Hardening Merge Evidence

## Verified topology

| Check | Result | Evidence |
| --- | --- | --- |
| Required hardening tag exists | passed | `v1.0.13-bug-fixed` → `91cd58ddcff57acf3ed846914feafaff603c69f2` |
| Hardening is an ancestor of feature HEAD | passed | `git merge-base --is-ancestor v1.0.13-bug-fixed HEAD` exited 0 |
| Hardening is in `origin/main` | passed | `git merge-base --is-ancestor v1.0.13-bug-fixed origin/main` exited 0; `origin/main` contains the tag |
| Protected hardening merge is visible | passed | `origin/main` at `6584bf0`, message `Merge pull request #3 from zhouwen-giser/release/v1.0-hardening` |
| Local feature state | passed | Phase 6 commit `e2698a0` is followed by hardening sync merge `df8b6e0`; clean acceptance and unified gate evidence exist |
| Remote feature publication | passed | `origin/feature/v1.1-mcp-tasks` → `38356ea`; normal non-force push |
| Feature → main pull request | passed | Ready PR #4, required title, base `main`, GitHub `MERGEABLE`, no configured status-check runs |
| `v1.1.0-rc.1` tag | passed | Annotated remote tag peels to exact isolated-audit commit `38356ea` |

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

Do not force-push, disable branch protection or tag an unverified dirty tree. Phase 6 RC publication is complete. The remaining path is protected review and merge of PR #4; stable `v1.1.0` may point only to the resulting release commit.
