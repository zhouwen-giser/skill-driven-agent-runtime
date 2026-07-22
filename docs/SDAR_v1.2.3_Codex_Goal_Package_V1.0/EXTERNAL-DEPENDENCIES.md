# External Dependencies and Gates

v1.2.3 has no required external product runtime. The six open-source repositories are read-only design/source inputs, not deployed dependencies.

## GATE-V122-BASELINE

Required before product behavior Goals complete:

- latest main contains the minimum v1.2.2 ancestor;
- current `pnpm verify` baseline is recorded;
- Goal/Plan/Outcome/Recovery/Business Events authority is identifiable;
- required v1.2.2 Ports and Runtime Facts are present or mapped.

If baseline verification fails:

- G00 records the failure;
- Skeleton, source intake, schema and isolated capability work may continue;
- no failing v1.2.2 baseline may be attributed to v1.2.3 without proof.

## GATE-GEMINI-SOURCE-LOCK

Only needed for direct TypeScript source port. Required evidence:

- exact locked commit is accessible;
- target files and license header are verified;
- Source Intake Report is approved;
- copied code is small, isolated and covered by behavior tests;
- THIRD_PARTY_NOTICES and source lock are updated.

If inaccessible, reimplement behavior from the package audit and do not claim direct port.

## GATE-AUTOSKILL-LICENSE

Direct source copy is prohibited until a standard license file or written permission is confirmed. This is not a blocker for clean-room algorithm reimplementation.

## GATE-MODEL-CANDIDATE

Unit and contract work may use deterministic fixtures or mock model adapters. Final online E2E for task understanding, plan patch, observation/reflection and promotion assessment requires a configured model candidate through the existing SDAR Model Runtime.

A missing model candidate blocks only final model integration/E2E; all Domain, persistence, queues, deterministic validation, API and fixtures must continue.

## Network policy

Codex may read official documentation and the locked GitHub commits. It may not modify external repositories, open PRs there, or silently track moving main branches instead of the locked commits.
