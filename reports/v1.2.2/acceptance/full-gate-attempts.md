# Unified Verification Attempt Ledger

Failed attempts are retained; neither failure was hidden or converted into a weaker gate.

1. Candidate `24b9421` passed bootstrap, clean baseline and 68-test integration, then failed one E2E
   stale-Skill-version recovery case. Root cause was the E2E loopback model's `??` boolean routing,
   which returned Skill metadata to a Workflow planning request. The route was corrected to boolean OR;
   the focused case and full 59-test E2E then passed.
2. Candidate `3115643` passed bootstrap (628 tests), architecture, A2A MUST, OpenAPI, protocol,
   license/SBOM, production build, migrations, 68 real integration tests and 59 E2E tests. The final
   infrastructure smoke loaded a stale local `.env` port `54329` and received `ECONNREFUSED`. The
   operator-managed test service is explicitly exposed on `55432`; the next clean-candidate run supplies
   that endpoint without changing or weakening the smoke test.
3. Candidate `08b552c` passed every preceding gate, including the explicit infrastructure smoke, then
   the Server smoke rejected its historical Skill fixture. The fixture lacked the v1.2.2 mandatory
   native Usage and `SkillOutcomeSpecification`; the product API correctly refused it. The smoke fixture
   now publishes both frozen contracts, and the focused Server/Console smoke passes without weakening
   Skill publication validation.

The machine summary in commit history records each attempt. The final acceptance report points only to
the later clean-candidate all-pass summary.
