# OSS Intake: A2A Protocol TCK (conditional external test tool)

- Official repository: `https://github.com/a2aproject/a2a-tck`
- Package/module: `a2a-tck` CLI/test suite
- Exact tag/commit/version: commit `5996b79f9cefa6fc390980e383e358a66fb9e49e`; project version `1.0.0`; repository `uv.lock` is present and must be used frozen.
- License and NOTICE: top-level `LICENSE` and README state Apache-2.0; `pyproject.toml` states MIT; no NOTICE file found. This metadata conflict is recorded in `docs/18_KNOWN_ASSUMPTIONS_AND_GAPS.md`.
- Requested use: external compatibility test tool only; not yet vendored or installed.
- Files or APIs inspected: README CLI, LICENSE, `pyproject.toml`, and presence/header of `uv.lock`.
- Capability needed: independent A2A MUST/SHOULD/MAY protocol conformance reports for HTTP+JSON, JSON-RPC and gRPC.
- Why current authoritative components cannot provide it: SDK self-tests do not independently prove protocol conformance; the TCK is the official cross-implementation verifier.
- Boundary/adapter: run from a temporary exact-commit checkout against a local SUT; only copy generated reports into `reports/`. No TCK type or code enters SDAR.
- Maintenance and upgrade plan: exact commit plus frozen `uv.lock`; update only with report comparison and license recheck.
- Security/quality findings: Python 3.11+ and uv required; current SUT Spike does not yet implement the complete lifecycle expected by the TCK. Running it becomes an EP-01 completion gate after submit/get/list/cancel/stream/resubscribe semantics exist.
- License obligations: if the tool is redistributed, resolve the MIT/Apache metadata conflict and retain the applicable license/notice. Temporary execution does not authorize source copying.
- Decision and ADR: conditional research/test approval under ADR-002 and ADR-006; not approved as a production dependency or vendored tool.
