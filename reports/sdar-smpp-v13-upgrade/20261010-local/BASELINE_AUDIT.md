# W0 baseline audit

Initial worktree: clean `main@f94d0b98d140dd22514029ccdc34978209426940`.
PR34 was absent locally; read-only fetch verified it is a descendant of that main.
Local working branch: `codex/sdar-smpp-v13-business-closure`, based on exact PR34 head
`52f54a11a40380f7c73bd9da277d640e49bdfbf7`; all nine changed files and twenty commits retained.
Current GitHub state: open, draft, unmerged; `pr34-current.json` is the retrieved metadata.
CI run 38033079355 / compat job 114157867047 succeeded (targeted format/lint/type/contract).
Fetching commit run listing first failed with a connector transport error; job retrieval succeeded.
Historical CI is not this upgrade's gate.

Archive SHA-256: `117312939268df2ac850766e27822e436c63126990cef8d6c5af062732ffefb5`.
42 files extracted safely to `.codex/sdar-smpp-v13`; package hashes and seven selftests passed.
The package's Asia/Tokyo metadata is retained; working reports use user timezone Asia/Shanghai.
Node 22.23.2 and installed pnpm 11.25.0; package.json declares pnpm 11.7.0. No dependency
version or lockfile was deliberately upgraded. The baseline test installed locked dependencies
through the existing pnpm launcher. The version difference is recorded, not hidden.

Pinned SMPP is locally available. Sibling current HEAD is different and is not compatibility
authority. Referenced chat `debug-ugv-provider` is active in the sibling repository; no message
was sent and no service there was used as acceptance evidence. Isolation uses loopback fixtures
and the existing uniquely named PostgreSQL/Redis verification projects.

Initial adapter/Registry baseline: 3 files / 102 tests PASS, command and source fingerprint in
`w0-baseline-203021040079/result.json`. M1 gate and additional contract tests are pending.
Site read, site write, selected GOWM qualification, publication and deployment: NOT_RUN.
