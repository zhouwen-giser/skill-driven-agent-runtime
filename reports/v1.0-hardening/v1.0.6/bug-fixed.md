# v1.0.6 Bug-fixed Review

Date: 2026-07-16

## Findings and fixes

- Same-status terminal saves could still replace Task output, Goal fields or Control pointers. Generic repositories now reject every update once the existing row is terminal; idempotent terminal replay is exclusively owned by Runtime Terminal Outcome.
- A malformed terminal Round could name another Control or plan, and cancellation could cite an unrelated Workflow instance. The transaction now validates Control/plan/decision and final-instance Goal/plan identity before writing.
- Active-control cancellation committed authority before separately closing waiting input. Waiting input now closes in the same transaction, so cleanup cannot cause a post-commit A2A error.
- Goal-wide cancellation canceled Task/Goal but left active Controls to fail later. Its existing cascade transaction now creates a canceled outcome/event for every active Control and closes pending input.
- Enhancement warning persistence could fail after the enhancement itself. Both failures are reported without changing committed authority.

## Review outcome

Terminal authority is monotonic in both status and content. Exact retries remain idempotent, malformed or stale evidence writes nothing, individual and Goal-wide cancellations agree with Control authority, and post-commit failures cannot block A2A terminal output.

Feature commit/tag: `4df20a9` / `v1.0.6`.

Bug-fixed commit/tag: reconciled after publication.
