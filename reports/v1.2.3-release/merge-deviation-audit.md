# SDAR v1.2.3 PR #9 Merge Deviation Audit

Captured at `2026-07-26T20:03:18+08:00`.

## Verified timeline

GitHub's public issue-event API records:

| Event | UTC time | Actor | GitHub App | Event ID |
| --- | --- | --- | --- | ---: |
| Ready for Review | `2026-07-26T11:52:21Z` | `zhouwen-giser` | none recorded | 28497629676 |
| merged | `2026-07-26T11:53:11Z` | `zhouwen-giser` | none recorded | 28497644347 |
| head branch deleted | `2026-07-26T11:53:42Z` | `zhouwen-giser` | none recorded | 28497653241 |

The merge created `d68195a7634a7c9694f0ba1e971d9327813fb03d` with parents
`10d9cb385a7d4ef87b69f2856d315573faafca9c` and
`f1f354c07ea0a6f32c911115973ea60aeab26b62`. Its author is the repository owner and its committer is
GitHub.

## Finding

No Codex Merge tool call was made. The public timeline contains no `auto_merge_enabled` event, the
merge event has `performed_via_github_app=null`, and the current repository snapshot reports
`allow_auto_merge=false`. Those facts do **not** prove how the owner-authenticated merge was initiated,
so the root cause remains unverified. Earlier evidence that called the event a GitHub native
“auto-merge” was too strong and has been corrected to **external owner-authenticated merge**.

The required unmerged protected-review state is therefore not satisfied. No `v1.2.3*` tag exists and
no automatic revert was attempted.

## Current containment

The already-running evidence push recreated
`feature/v1.2.3-cognitive-planning-runtime`. Corrective PR
<https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/11> is open, Draft and unmerged at
`219061f5829830abb2815863713e2a313987ec86`. It must remain Draft until the user chooses whether to
accept the terminal deviation or explicitly authorizes a separately planned corrective change.
