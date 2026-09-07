# P00 Object and package map

| Frozen object | Authoritative store | Planned owner | Existing authority adapted |
| --- | --- | --- | --- |
| NodeProfile | Control PostgreSQL | `packages/node-control-domain` | none |
| ConfigurationRevision/Application | Control PostgreSQL | `node-control-domain/application/persistence` | runtime-control port only |
| LlmProviderDefinition/ModelRoute | Control PostgreSQL | Node Control packages | existing model invocation stays Runtime-owned |
| SmppRegistrySource/Snapshot | Control PostgreSQL LKG | Node Control + SMPP adapter | Registry is candidate-only |
| McpProviderBinding | Control PostgreSQL | Node Control packages | live catalog/availability remain Runtime-owned |
| NodeCapabilityDefinitionVersion | Control PostgreSQL | Node Control packages | replaces no existing Skill authority |
| CapabilityImplementationBinding | Control PostgreSQL | Node Control packages | references exact Skill/Artifact/Provider versions |
| CapabilityReadinessSnapshot | Runtime PostgreSQL | existing Runtime plus bounded capability module | Control API reads observed projection only |
| A2AExposureVersion | Control PostgreSQL | Node Control packages | Runtime applies an immutable snapshot |
| AgentCardRevision | Runtime PostgreSQL | A2A adapter/runtime persistence | Agent Card exposes only accepted Exposures |
| TaskCapabilityBinding/Attempt | Runtime PostgreSQL | existing Domain/Application/Persistence | created atomically with accepted Task |
| TelemetryExportConfiguration/Status | Control PostgreSQL plus exporter cursor | Node Control + export adapter | no telemetry-query DTO or history authority |
| ManagementOperation/AuditEvent | Control PostgreSQL | Node Control packages | independent from Runtime management operations |

Planned processes are `apps/node-control-api` and `apps/node-control-worker`. Existing `apps/server`
remains the Runtime composition root. No Console implementation is in this backend-only Goal.
