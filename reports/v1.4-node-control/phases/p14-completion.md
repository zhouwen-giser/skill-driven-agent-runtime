# P14 Completion Report

## Goal

Qualify SDAR v1.4.0 from the latest main ancestor, close release/security/recovery evidence, publish
a non-draft PR and merge only after live GitHub checks, review and mergeability permit it.

## Baseline

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `0c66d5c79e1b67188809e76912ac6d2f6d10fd5e`
- latestObservedMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- mainSyncSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8` (already ancestor; no empty merge)

## Implementation

- implementationSha: `47fb8c31ffb474eb2266e4d7b104ae425a3fb530`
- recoveryFixAndVerifiedCandidateSha: `e6d0b698fb0430386edba66474f8214f9f4bd740`
- evidenceSha: `PENDING_EVIDENCE_COMMIT`
- remoteSha: `PENDING_P14_PUSH`
- changedFiles: 403 paths from baseline through the verified candidate; P14 itself updates version,
  release/governance records, the versioned SBOM and self-contained recovery smoke.

## Frozen Contracts

- designFreezeSha: recorded unchanged in `baseline/source-lock.json`
- backendApiFreezeSha: recorded unchanged in `baseline/source-lock.json`
- frozenManifestSha256: `a06a13c60c31a3b914462b4a16d62a2f652217c6f5df7adf640d73b98bb4d7fc`
- contractChanges: none; version remains frozen 1.0.0
- ADRs: no new authority decision; existing v1.4 ADRs remain controlling

## Validation

| Command | Result | Passed | Failed | Skipped |
|---|---|---:|---:|---:|
| `pnpm verify:v14-security` | passed | 4,436 files / frozen 76 files | 0 | 0 |
| `pnpm audit --prod --audit-level high` | passed threshold | 0 Critical / 0 High | 0 | 1 Moderate retained |
| `pnpm test:a2a-tck` | passed | 74 | 0 | 161 |
| `pnpm verify:v14-recovery` | passed | real backup/restore/restart/outage chain | 0 | 0 |
| `pnpm verify` | passed in 581,785 ms | 938 Unit + 22 performance + 220 Contract + 149 Integration + 72 E2E | 0 | 0 |

The exact-candidate summary records `commit=e6d0b698...`, `dirty=false`, all eight composed steps
passed, and SHA-256 `06dfda472b63f01b4d58bc478db3edf2324ef13e056edbd1cd3f112200d45fde`.

## Real / Simulated Classification

PostgreSQL/Redis integration, migrations, HTTP contracts, TCK, Control dump/restore, API restart,
credential rotation/revocation and Runtime-after-Control-stop are real local evidence. External
model/MCP endpoints are controlled test providers. Production HA, SLO, capacity, RTO/RPO and
deployment remain unverified and unclaimed.

## Failed Attempts and Root Causes

The versioned SBOM was stale after the version bump; the recovery smoke had a hidden Console-build
order dependency; sandbox Docker access and an offline pnpm tarball were unavailable. All are
retained with root causes and successful reruns in `p14-release-qualification.md`.

## Architecture and Authority Check

P14 read-only review: 0 Blocking / 0 Major / 0 Minor. No Console product code, Telemetry Query,
ClickHouse proxy, multi-node orchestration, second Runtime, authority relocation or forbidden Task
Control implementation was introduced.

## Security and Secrets

Zero secret findings, SecretRef-only public contracts, administrator-only writes, bounded role and
tenant scopes, request/rate limits, exact/CIDR allowlists and non-loopback TLS pass. Production audit
has 0 Critical/High and one documented Moderate below the blocking threshold.

## Known Limitations

This is a local release qualification, not a deployment or production availability claim. No tag,
GitHub Release or deployment is part of P14.

## Handoff

- status: `QUALIFIED_FOR_PUBLICATION`
- nextPhase: none
- prerequisites: push without force, create the prescribed non-draft PR, confirm live base/head,
  checks/reviews/mergeability, merge with Merge Commit if permitted, and verify candidate ancestry.
