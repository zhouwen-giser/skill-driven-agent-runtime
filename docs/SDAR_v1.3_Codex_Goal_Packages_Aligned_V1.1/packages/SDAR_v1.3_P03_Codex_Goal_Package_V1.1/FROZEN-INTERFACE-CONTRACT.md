# P03 冻结接口合同 V1.1

共享注册表：`../../shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json`
注册表：`SDAR_v1.3_Frozen_Interface_Registry_V1.2.json`（V1.1 immutable delta）

注册表 SHA-256：`8aa828faf544b2cad3d3eb72bfc0935b02ba324a517de1563308862fc7d60dee`

P04R 覆盖合同：`ExperienceActivityRef V1.2`、`ExperienceTraceEvent V1.2`、`ProcessVariant V1.2`、`WorkflowPattern V1.2`。

## 消费接口

### ArtifactRepository
- Version: `1.1`
- Schema hash: `617560087d746b79cd5fa38f82bf8c7a90448f56e5b54c1117f0b186bae54c53`
- Signature: `findActiveIndex(query); getDefinition(ref); saveCandidate(candidate); activate(input); deprecate(input)`

## 生产接口

### ExperienceTrace
- Owner: `P03`
- Version: `1.1`
- Schema hash: `d929a15aa9fc268bd713ddf9d44d8b1a856d8edc8acf8650ddc1b8511945c4f9`
- Fields: `traceId`, `sourceEpisodeId`, `taskTypeRefs`, `goalFingerprint`, `capabilityFingerprint`, `environmentFingerprint`, `trace`, `completeness`, `dataClassification`, `normalizerVersion`, `sourceHash`, `createdAt`

### ExperienceTraceEvent
- Owner: `P03`
- Version: `1.1`
- Schema hash: `8b9742001edfbbe7a6dc93971d5f08dff002f32d56a7ca124c5b54e59133a878`
- Fields: `eventId`, `sequence`, `occurredAt`, `eventType`, `actorType`, `capabilityRefs`, `authorityRefs`, `parentEventRefs`, `concurrencyGroup`, `branchRef`, `payloadSummary`

### CohortDefinition
- Owner: `P03`
- Version: `1.1`
- Schema hash: `864abd2238982993ced478f96be4a65eb53b6813f8a984b2b1c05175a44a4f90`
- Fields: `tenantId`, `taskTypeId`, `goalFingerprint`, `capabilityFingerprint`, `environmentClass`, `deviceClass`, `timeRange`, `minimumCompleteness`

### ProcessVariant
- Owner: `P03`
- Version: `1.1`
- Schema hash: `f8f772dfbc589945e691bb9052b0164941e62dab0f7ac68f7d8021c16010fa86`
- Fields: `variantId`, `activitySequence`, `concurrencyGroups`, `branchSequence`, `occurrenceCount`, `traceRefs`, `successCount`, `failureCount`

### DiscoveredProcessPattern
- Owner: `P03`
- Version: `1.1`
- Schema hash: `de261049c901dc1e19fcce26adc665149f1cfab9c7b83a2f25e2a6b5fbd70eac`
- Fields: `patternId`, `cohortFingerprint`, `algorithmVersion`, `mandatoryActivities`, `optionalActivities`, `orderingConstraints`, `parallelCandidates`, `recoveryBranches`, `failureVariants`, `supportRefs`, `contradictionRefs`, `environmentCoverage`, `quality`

### WorkflowPattern
- Owner: `P03`
- Version: `1.1`
- Schema hash: `5ff2cbf281b8c298e1ae972879c4c7ffc7264eb5e5358912c4c46de94080f99b`
- Fields: `workflowPatternId`, `taskTypeId`, `activityPatterns`, `dependencyPatterns`, `recoveryPatterns`, `sourcePatternRef`, `sourceTraceRefs`, `quality`
