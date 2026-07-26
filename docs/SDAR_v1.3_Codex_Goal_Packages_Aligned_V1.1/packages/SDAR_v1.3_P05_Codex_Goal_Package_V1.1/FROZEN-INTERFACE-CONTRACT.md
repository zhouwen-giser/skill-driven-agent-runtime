# P05 冻结接口合同 V1.1

共享注册表：`../../shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json`
注册表 SHA-256：`d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`

## 消费接口

### CompiledArtifact
- Version: `1.1`
- Schema hash: `8afcafacad1085eb35d7b3fb0dd7715b05e7ff279f0d78b529a4b64fbe39bdcf`
- Fields: `artifactId`, `artifactKey`, `version`, `artifactType`, `name`, `description`, `scope`, `definition`, `applicability`, `requiredCapabilities`, `requiredPolicies`, `dependencySnapshot`, `riskLevel`, `status`, `lineageRef`, `validationSummaryRef`, `contentHash`, `createdAt`

### ExperienceTrace
- Version: `1.1`
- Schema hash: `d929a15aa9fc268bd713ddf9d44d8b1a856d8edc8acf8650ddc1b8511945c4f9`
- Fields: `traceId`, `sourceEpisodeId`, `taskTypeRefs`, `goalFingerprint`, `capabilityFingerprint`, `environmentFingerprint`, `trace`, `completeness`, `dataClassification`, `normalizerVersion`, `sourceHash`, `createdAt`

### CandidateStaticValidationResult
- Version: `1.1`
- Schema hash: `3365fa7c49f249c3ea0935d87781da8d90253d6683bba97075beff1276278aba`
- Fields: `artifactRef`, `schemaValid`, `dagValid`, `requiredCriteriaCovered`, `capabilityShapeValid`, `parameterPolicyValid`, `sideEffectReplaySafe`, `boundsValid`, `duplicateFingerprint`, `errors`, `warnings`, `validatorVersion`, `result`

## 生产接口

### ArtifactReplayCase
- Owner: `P05`
- Version: `1.1`
- Schema hash: `ab24f3c2d8a692f6e569c7e95f04f4389244941da0b297ec799610e8d1bab64f`
- Fields: `replayCaseId`, `tenantId`, `requestSnapshotRef`, `goalContractSnapshotRef`, `capabilityCatalogSnapshotRef`, `worldStateSnapshotRef`, `policySnapshotRef`, `readinessSnapshotRef`, `acceptedPlanSnapshotRef`, `executionTraceSnapshotRef`, `outcomeSnapshotRef`, `correctionRefs`, `environmentClass`, `deviceClass`, `taskTypeId`, `sourceEpisodeRefs`, `goalLineageHash`, `snapshotCompleteness`, `contentHash`

### ReplayDatasetManifest
- Owner: `P05`
- Version: `1.1`
- Schema hash: `132f1c215f12fdd28388ac3879589fd22e8772f1fd75ce058ce36977802c746e`
- Fields: `datasetId`, `datasetVersion`, `purpose`, `tenantId`, `taskTypeIds`, `caseRefs`, `splitPolicyVersion`, `sourceRange`, `sourceHash`, `contentHash`, `leakageCheckRef`, `createdAt`

### ArtifactValidationRun
- Owner: `P05`
- Version: `1.1`
- Schema hash: `c602d26e36dc9fc55b0ecaeeeebbf962af8e4d8f80080b7d9f12798be2afdd1a`
- Fields: `validationRunId`, `artifactId`, `artifactVersion`, `validationType`, `datasetRef`, `status`, `result`, `metrics`, `counterexampleRefs`, `startedAt`, `completedAt`

### ArtifactValidationResult
- Owner: `P05`
- Version: `1.1`
- Schema hash: `0a9b4fe3b71242744760ecf7bfcd14cf4272b32ac130e111878f67f3514fd64b`
- Fields: `validationRunId`, `artifactRef`, `datasetRef`, `validationType`, `metrics`, `failureRefs`, `counterexampleRefs`, `unsafe`, `result`, `validatorVersion`, `metricCatalogVersion`, `artifactHash`, `datasetHash`, `resultHash`, `completedAt`

### ArtifactValidationFailure
- Owner: `P05`
- Version: `1.1`
- Schema hash: `e017c434add5d1f1aec004552a8795c34509461699d351d879a02003ddb37182`
- Fields: `failureId`, `validationRunRef`, `replayCaseRef`, `category`, `severity`, `expectedRef`, `actualRef`, `evidenceRefs`, `explanation`

### ArtifactCounterexample
- Owner: `P05`
- Version: `1.1`
- Schema hash: `ef317932640d095863d9bb13c96e2f738989bc7858aec9a613f76c4438ad46f3`
- Fields: `counterexampleId`, `artifactRef`, `replayCaseRef`, `failureRef`, `conditionFingerprint`, `environmentClass`, `failureBoundaryCandidate`, `sourceRefs`, `status`, `createdAt`

