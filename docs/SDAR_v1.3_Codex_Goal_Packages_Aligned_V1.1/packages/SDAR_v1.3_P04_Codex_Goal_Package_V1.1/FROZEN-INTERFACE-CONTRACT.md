# P04 冻结接口合同 V1.1

共享注册表：`../../shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json`
注册表：`SDAR_v1.3_Frozen_Interface_Registry_V1.2.json`（V1.1 immutable delta）

注册表 SHA-256：`8aa828faf544b2cad3d3eb72bfc0935b02ba324a517de1563308862fc7d60dee`

P04R 消费 `WorkflowPattern V1.2`，并发布 `FusedPattern V1.2`、`GeneralizedPattern V1.2`、`CandidateStaticValidationResult V1.2`。

## 消费接口

### WorkflowPattern
- Version: `1.1`
- Schema hash: `5ff2cbf281b8c298e1ae972879c4c7ffc7264eb5e5358912c4c46de94080f99b`
- Fields: `workflowPatternId`, `taskTypeId`, `activityPatterns`, `dependencyPatterns`, `recoveryPatterns`, `sourcePatternRef`, `sourceTraceRefs`, `quality`

### CompiledArtifact
- Version: `1.1`
- Schema hash: `8afcafacad1085eb35d7b3fb0dd7715b05e7ff279f0d78b529a4b64fbe39bdcf`
- Fields: `artifactId`, `artifactKey`, `version`, `artifactType`, `name`, `description`, `scope`, `definition`, `applicability`, `requiredCapabilities`, `requiredPolicies`, `dependencySnapshot`, `riskLevel`, `status`, `lineageRef`, `validationSummaryRef`, `contentHash`, `createdAt`

### PlanTemplateArtifactDefinition
- Version: `1.1`
- Schema hash: `b089d44944f3db3c5fcfff016a5b56f5d3482d89088448697b5cd4f20d425d04`
- Fields: `goalPattern`, `parameterSchema`, `parameterBindings`, `skillGoalGraph`, `completionContractTemplate`, `recoveryBranches`

## 生产接口

### FusedPattern
- Owner: `P04`
- Version: `1.1`
- Schema hash: `df1216e93f02a3ec0cc24d96547d5db3436500789818ec8bcee3847fcbd9d24e`
- Fields: `fusedPatternId`, `sourceWorkflowPatternRef`, `sourceProcessPatternRef`, `sourceTraceRefs`, `structuralPattern`, `semanticCandidate`, `applicabilityCandidate`, `supportRefs`, `contradictionRefs`, `confidence`, `fusionVersion`, `contentHash`

### GeneralizedPattern
- Owner: `P04`
- Version: `1.1`
- Schema hash: `96f2c70c36985897ebbc700b540048314cad2e2597777e7b9b64118e227a08bd`
- Fields: `generalizedPatternId`, `domain`, `taskTypeId`, `variables`, `invariants`, `requiredConditions`, `forbiddenConditions`, `retainedExampleRefs`, `counterexampleRefs`, `sourceFusedPatternRef`, `generalizerVersion`, `contentHash`

### CandidateStaticValidationResult
- Owner: `P04`
- Version: `1.1`
- Schema hash: `3365fa7c49f249c3ea0935d87781da8d90253d6683bba97075beff1276278aba`
- Fields: `artifactRef`, `schemaValid`, `dagValid`, `requiredCriteriaCovered`, `capabilityShapeValid`, `parameterPolicyValid`, `sideEffectReplaySafe`, `boundsValid`, `duplicateFingerprint`, `errors`, `warnings`, `validatorVersion`, `result`
