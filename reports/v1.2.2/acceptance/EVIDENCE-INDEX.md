# SDAR v1.2.2 Final Evidence Index

| Evidence | Path | Classification |
| --- | --- | --- |
| Master final acceptance | `final-acceptance.{md,json}` | independent audit summary |
| Client conformance | `client-conformance.{md,json}` | frozen fixtures + real runtime |
| Unified gate | `../../verification/summary.{md,json}` | clean real/local gate |
| Real Provider interop | `../../v1.2.2-interop/real-provider-interop.{md,json}` | real external Provider |
| Failed interop attempts | `../../v1.2.2-interop/real-provider-interop-attempts.md` and failure JSON | retained failures |
| Failed unified attempts | `full-gate-attempts.md` | retained failures |
| Database restart | `database-restart-audit.md` | real disposable PostgreSQL restart |
| G00–G02 | `../G00-BASELINE.md`, G01/G02 reports, `../evidence/G00-EVIDENCE-INDEX.md` | baseline/product |
| G03–G09 | seven Goal reports and `../evidence/G03-G09-EVIDENCE-INDEX.md` | implementation/tests |
| G10 | `../G10-HARDENING-INTEROP-RELEASE.md` | release hardening |
| Traceability | `../../../docs/26_V1_2_2_TRACEABILITY.md` | AC-001–AC-078 |

Draft PR #7 is <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/7>; evidence head
`3ba0d59` is published and this closure commit follows it. No Mock report substitutes for real Provider
interop.
