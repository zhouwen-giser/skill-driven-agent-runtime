# External Provider Dependency Status

Observed 2026-07-22 from read-only sibling worktree `../sdar-mcp-tasks-provider-runtime`.

## Repository boundary

- Branch: `feature/business-events-profile-v1`.
- HEAD/source candidate: `196620a` (`test(interop): publish business events conformance evidence`).
- Required ancestor `ee14d2fa2b5130d3c7c016c71737175a124d5134`: present.
- Source/protocol files are clean.
- Fifteen generated report files are modified, including Business Events conformance reports and one
  runtime-conformance follow-up report. SDAR did not modify, stage, commit or reset them.

## EXT-BE-SKELETON

Status: `candidate_present_review_pending`.

Clean tracked assets include the Profile document, three Business Events schemas, Adapter protocol,
13 valid/invalid fixtures, migration and contract/conformance scripts.

Schema SHA-256 observed from the clean worktree:

| Asset | SHA-256 |
| --- | --- |
| `sdar-business-events-v1.schema.json` | `dceb9ee64e414890813b784880a2d90f710c93faa0c8aaa8b4f2b7d6ba9b7e6f` |
| `sdar-business-events-continuity-v1.schema.json` | `f92d0ad364a2f4ec068f99a0501a74a2d38748244ba6a04a85893527263807f0` |
| `sdar-business-events-relation-v1.schema.json` | `7e3bbe9d9ac96d10b4ab399cf5c90621a070959c3bdfb092327400c96a216dc4` |

G07 must still verify every required asset, golden vector, header/error contract, source commit and
Skeleton Review conclusion against V0.5.2 before vendoring. G00 does not claim the gate passed.

## EXT-BE-RUNTIME-CANDIDATE

Status: `candidate_present_interop_not_run`.

The external worktree contains Provider runtime code, Business Events persistence/migration, stream,
continuity, relation, capacity/security tests and an interop runner. Its own tracked
`interop-blocker.json` states:

```text
status=blocked
claimLevel=Level 2 Component Conformance
interopCertified=false
reason=Neither SDAR_INTEROP_COMMAND nor SDAR_INTEROP_REPO is available.
```

All 13 required interop matrix items are listed as unexecuted. Modified generated reports are not accepted
as final evidence. G10 requires a reproducible exact candidate, real public-interface interop and SDAR-side
reports; no Mock may substitute.

## Provider defects

None filed. The dirty-report and unexecuted-interop facts are evidence readiness conditions, not a
Provider contract defect.
