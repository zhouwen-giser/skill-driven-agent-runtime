# ADR-142: UGV joint development and observational telemetry

Status: Accepted (user-approved 2026-08-26)

## Decision

The explicit `ugv:debug` profile composes SDAR, SMPP and smpp-telemetry-platform, without Grafana.
Its public business/management/debug endpoints use a trusted development principal without login
and listen on LAN interfaces. Generic production and acceptance defaults remain unchanged;
internal machine credentials and business confirmation/validation are not disabled. Public Agent
Card addresses are separate from bind addresses. The launcher acknowledges the insecure intranet
deployment and prints its exposure and physical side-effect mode; default final mode is YES.

SMPP's existing ProviderOps reliable export still acknowledges only after Processor WAL fsync.
Collector's pinned ClickHouse exporter writes independent diagnostic metrics/traces through a
persistent sending queue. Migration-owned tables retain seven days. Export failure cannot become
a Task execution retry, a business state transition or a second workflow authority. PostgreSQL
ownership, LangGraph execution and SDAR canonical evidence contracts are unchanged.

Ordinary lifecycle operations preserve data and never submit tasks or invoke Device tools. The
development startup does not call acceptance qualification or destructive clean-start scripts.

The development YES transition validates the existing owner-only local simulation identity
independently of unrelated historical B02 acceptance report formats. It does not issue or rewrite
an identity or claim a new acceptance window. Explicit successor IDs still require the full formal
authorization chain. The ordinary/acceptance supervisor keeps its existing authorization behavior;
only the explicit development composition selects this policy, before both stop and spawn.

## Consequences

Anyone on the reachable trusted network can use public management and execution interfaces.
Do not expose this profile to the Internet. Diagnostic delivery is not the ProviderOps audit
contract; saturation is visible as degradation rather than silently claiming complete telemetry.
Collector metrics support is alpha: pin the exporter/schema together and verify real ClickHouse
compatibility. Reverting the deployment profile leaves stored data intact.
