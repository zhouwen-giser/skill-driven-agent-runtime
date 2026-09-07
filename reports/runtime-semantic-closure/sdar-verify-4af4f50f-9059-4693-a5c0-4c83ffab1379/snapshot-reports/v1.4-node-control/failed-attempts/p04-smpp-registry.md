# P04 Retained Failed Attempts

## Static and focused repairs

- The first static pass found exact-optional-property, HTTP handler typing, `return await` and lint
  findings. The types and call sites were corrected without disabling strictness or lint rules.
- The first focused Integration command targeted a nonexistent Control test database. No P04 test
  body ran, so that attempt is not classified as evidence. The official Integration driver was used
  for every subsequent real PostgreSQL run.
- The first official Integration run passed the P04 assertions but left its Node Profile fixture in
  Control PostgreSQL, causing the later configuration suite to report
  `CONTROL_SINGLE_NODE_IDENTITY_CONFLICT`. P04 now removes only its own fixtures in `afterAll`.
- The next official run passed all 136 test bodies but its P04 cleanup hook omitted empty tables that
  still referenced the truncated tables. The cleanup list was completed in foreign-key-safe scope;
  no broad database reset or existing volume deletion was used.

## Review repairs

- Pre-review inspection found that a newer draft Source revision could hide the prior active Source
  and its LKG. Source activation is now atomic, exactly one revision can be active, failed draft sync
  leaves the old active revision visible, and successful Latest/304 refresh activates the new Source
  revision. A real PostgreSQL regression covers revision 1 through failed and successful revision 2.
- The first independent read-only review closed at 0 Blocking / 1 Major / 0 Minor. The Major finding
  was that the candidate rows retained Snapshot revision/checksum through their foreign key, but the
  public candidate projection omitted that lineage. The projection now returns Registry revision,
  checksum, ETag and valid-until together with Catalog revision; the real multi-source regression
  verifies all fields. The repeated read-only review closed at 0 / 0 / 0.

## Full verification

- The first `pnpm verify` passed formatting, 1,143 Unit/Contract tests, architecture, frozen
  contracts and build, then the migration-path process could not read the Windows Docker credential
  configuration inside the filesystem sandbox (`Access is denied`; credential helper logon session
  unavailable). This is retained as an environment-permission failure, not a product pass.
- The exact same full command was rerun outside the sandbox under the user's Docker authorization.
  It passed in 354,538 ms, including the Docker migration path, 136 real Integration tests, 72 E2E
  tests, production build and every process smoke.

No assertion was weakened, no test was skipped to make the gate green, no credential was persisted
in evidence, and no pre-existing Docker volume was deleted.
