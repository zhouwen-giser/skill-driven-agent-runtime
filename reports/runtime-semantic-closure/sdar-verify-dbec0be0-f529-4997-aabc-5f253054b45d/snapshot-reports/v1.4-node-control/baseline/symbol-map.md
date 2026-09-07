# P00 Frozen-to-repository symbol map

This map records planned symbol ownership before implementation. Exact exported names are confirmed in
the owning phase and updated here rather than duplicated in an adapter.

| Frozen contract | Planned Domain/Application symbol | Adapter/API boundary | Phase |
| --- | --- | --- | --- |
| NodeProfile, ManagementOperation, AuditEvent | Node Control aggregates and ports | Node Control HTTP/PG | P01 |
| ConfigurationRevision, RuntimeConfigAck, LKG | revision aggregate and application service | runtime-control client | P02 |
| LlmProvider, ModelRoute | provider/route aggregate and validation service | runtime-control mapping | P03 |
| SmppRegistrySource, RegistrySnapshot | source/snapshot aggregate | SMPP Registry adapter | P04 |
| McpProviderBinding, CatalogSnapshot | binding/catalog aggregate | existing MCP adapter port | P05 |
| NodeCapabilityVersion, ImplementationBinding | capability aggregate and publish service | Node Control HTTP/PG | P06 |
| CapabilityReadiness | Runtime-owned snapshot/calculator | internal Runtime Control API | P07 |
| A2AExposureVersion, AgentCardRevision | exposure aggregate/application | A2A projection adapter | P08 |
| TaskCapabilityBinding, TaskExecutionAttempt | Runtime Domain/Application services | Runtime PG transaction | P09 |
| SkillVersion, PlanTemplateVersion | management DTO adapters only | existing Skill/Artifact authorities | P10 |
| TelemetryExportConfiguration/Status | export config aggregate | telemetry export adapter | P11 |
| WellKnownNode, NodeEventEnvelope | profile projection/event outbox | public profile/events | P12 |
| auth, SecretRef, backup/restore/upgrade | policy and operational services | API middleware/runbooks | P13 |
