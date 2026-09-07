# SDAR v1.4 latest-main baseline

Status: `PASSED`

The exact implementation baseline is `origin/main` commit
`a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`, tree
`2b43d3200a7d772726d9f4f5349ff4fffa338cef`, committed at
`2026-08-02T00:13:32+08:00`. The v1.4 branch was created directly from this commit; its merge base and
starting HEAD both equal the baseline SHA.

## Frozen source identity

| Input | SHA-256 |
| --- | --- |
| Task package `SOURCE_LOCK.json` | `1f028c017630a9f2af417ed674dca0eb36dcdb0586787b272a4b539f96ebf31e` |
| Complete design freeze ZIP | `1d0c72a9a54baf88ddd0a2d8a585b33e0c1ba056694c16b37cf19e6b18dfb4cb` |
| Backend API freeze ZIP | `367797107847c210bb4240d5525ad0cfa625f8f65856f1eddc7c61bff2523d1c` |
| Frozen Interface Registry v1.2 | `3b920aa70b142681666278ebc1bfe7bba3f5eb5485d4cc8d67cfa0c1ce1dd1a7` |

Both ZIPs were extracted into a dedicated temporary directory and their packaged validators passed.
The task-package validator reported `TASK_PACKAGE_OK`, 15 phases and two frozen inputs. The design
validator returned `{ "ok": true, "errors": [] }`; the API validator reported 28 JSON schemas, 111
operation IDs, 20 event messages and seven fixtures.

## v1.3 dependency gate

Latest main contains the required PostgreSQL runtime authority, the single LangGraph workflow runtime,
Skill Version, Plan Template/Artifact authority, A2A projection, MCP Provider/Remote Task path,
transactional outbox, Management OpenAPI, and equivalent final P00-P13 evidence. No code or evidence
was copied from the old v1.3 feature branch.

## Verification

`pnpm install --frozen-lockfile` passed. The first `pnpm verify` attempt was blocked by sandbox access
to Docker configuration. The privileged retry reached PostgreSQL but exposed a pre-existing
Debian-initialized `sdar` volume that cannot be used by the hardened Alpine image: PostgreSQL returned
`XX000` because `template1` had no determinable collation version. The existing volume was not
deleted, reset, mounted into a replacement container, or overwritten.

The same full gate then ran with the isolated Compose project `sdar-v14-baseline-019fa7dc` and passed
in 345479 ms:

- 1122 unit/contract tests;
- 130 real Docker PostgreSQL/Redis integration tests;
- 72 real Docker PostgreSQL/Redis/model/MCP E2E tests;
- 27 additive migrations through `0134_v13_artifact_management_projection`;
- 164 Management OpenAPI operations;
- architecture, A2A baseline, source pins, protocol, SBOM/license, production builds, infrastructure
  smoke, and server/console smoke.

The isolated verifier summary records `dirty=true` because `verify-full.mjs` writes its own report
files before calculating that field. The detached checkout was clean before the command and remained
unchanged except for gate-generated `reports/verification` output.

## Repository settings

GitHub identifies `main` as the default branch. Merge commits, squash merges and rebase merges are
enabled; delete-branch-on-merge is disabled. The branch-protection endpoint returned 404 (`Branch not
protected`). P14 nevertheless follows the frozen no-bypass, checks, review and explicit Merge Commit
policy.
