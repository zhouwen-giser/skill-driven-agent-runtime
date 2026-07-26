# P11 冻结接口合同 V1.1

共享注册表：`../../shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json`
注册表 SHA-256：`d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`

## 消费接口

### FastGateway
- Version: `1.1`
- Schema hash: `be8f17ffcf597a021a8758844521cf4ba43dd1537e0d74dc7be2116c91cc16fe`
- Signature: `evaluate(input: RuntimeRequestContext): Promise<RuntimeExecutionDecision>`

### RuntimeExecutionDecision
- Version: `1.1`
- Schema hash: `4ad37edc562bf39d27982f23f70d27ee8af1a3dfe3486dfc34725eec62b5b4de`
- Fields: `decisionId`, `requestId`, `path`, `selectedArtifactRef`, `parameterBindings`, `missingParameters`, `requiredConfirmations`, `reasonCodes`, `matcherSnapshotHash`, `policySnapshotHash`, `createdAt`

### FormalPlanHandoffPort
- Version: `1.1`
- Schema hash: `84f9be4c6bcd7ed775c1f56779f671709efe541edc498b6bb71047a1e55d9336`
- Signature: `submit(candidate: UserGoalPlanCandidate): Promise<FormalPlanHandoffResult>`

### CaseArtifactDefinition
- Version: `1.1`
- Schema hash: `c1b03024222e19ed2834e25accdb8e4d841ae3e2d35ea28ecba056a79d585ea5`
- Fields: `problemFingerprint`, `solutionPattern`, `adaptationRules`, `applicability`, `failureBoundaries`, `priorOutcomeSummary`

### ModelRouteArtifactDefinition
- Version: `1.1`
- Schema hash: `2f271f5b96f9d83675b2176ea8f7a8eea76a86f1e3cc5e52c255a42cb6016678`
- Fields: `conditions`, `route`, `budget`, `fallbackRoutes`

## 生产接口

### CaseRetrievalInput
- Owner: `P11`
- Version: `1.1`
- Schema hash: `161342c806b7f58254efac7d076d3193da80982d9c0bea22998c91e71cd3b1de`
- Fields: `runtimeRequestRef`, `goalContextRef`, `taskTypeId`, `problemFingerprint`, `tenantId`, `deadlineAt`, `runtimeSnapshotHash`

### CaseMatch
- Owner: `P11`
- Version: `1.1`
- Schema hash: `135dbfad26d68afa26201c43cf69816a80be23d4a550c28062a755ff6cfb084f`
- Fields: `caseRef`, `score`, `applicability`, `failureBoundaryStatus`, `reasonCodes`

### CaseAdaptationInput
- Owner: `P11`
- Version: `1.1`
- Schema hash: `0c81b6bcabb43c588175a33d2621c431463a2547a6040efdfe39883e3a427929`
- Fields: `caseRef`, `goalContextRef`, `parameterBindingRef`, `policyDecisionRef`, `deadlineAt`, `runtimeSnapshotHash`

### CaseAdaptationResult
- Owner: `P11`
- Version: `1.1`
- Schema hash: `b2cd17de0f8a9bd09948981f29c368a1bc0ae18fedf4c9caf4d422e26ed2a72d`
- Fields: `caseRef`, `parameterMappings`, `planPatchCandidate`, `recoveryPlanCandidate`, `confidence`, `unknowns`, `validationRequired`

### CaseRuntime
- Owner: `P11`
- Version: `1.1`
- Schema hash: `a2cb1f3f4c0a18abf03d3fb1a552b1f480e11e8a2ac5d3f1aa98c849dd96a387`
- Signature: `retrieve(input: CaseRetrievalInput): Promise<CaseMatch[]>; adapt(input: CaseAdaptationInput): Promise<CaseAdaptationResult>`

### ModelProfile
- Owner: `P11`
- Version: `1.1`
- Schema hash: `03bc8f277534a5a1529d186697f7afa61eb27342a2f6ca6da85e5521d2af70bd`
- Fields: `profileId`, `providerId`, `modelId`, `modelVersion`, `capabilityTags`, `qualityTier`, `latencyTier`, `costTier`, `contextWindow`, `modalities`, `structuredOutputSupport`, `toolCallingSupport`, `dataResidency`, `dataClassificationAllowance`, `rateCapacity`, `readiness`, `health`, `profileVersion`

### ModelRouteContext
- Owner: `P11`
- Version: `1.1`
- Schema hash: `346e0917e77a181b332581bfdb94943742dc0dfec035938e50ba3ac225b93aa2`
- Fields: `requestRef`, `tenantId`, `taskTypeId`, `operationType`, `riskLevel`, `dataClassification`, `requiredCapabilities`, `outputSchemaRef`, `deadlineAt`, `budget`, `policySnapshotHash`, `providerProfileSnapshotHash`

### ModelRouteDecision
- Owner: `P11`
- Version: `1.1`
- Schema hash: `9785cd514c16f49982012f3943441defe246c33dfcf3429a3504885187b7d1fd`
- Fields: `route`, `reasonCodes`, `budget`, `fallbackRoutes`, `selectedProfileRefs`, `decisionHash`

### ModelCascadeRun
- Owner: `P11`
- Version: `1.1`
- Schema hash: `160a4e179dc1911f4b56557361bb0c688ea79d6c7f0964646fe70309959591df`
- Fields: `cascadeRunId`, `routeDecisionRef`, `status`, `stepRefs`, `selectedOutputRef`, `totalCostUnits`, `totalInputTokens`, `totalOutputTokens`, `completedAt`

### ModelRouteRuntime
- Owner: `P11`
- Version: `1.1`
- Schema hash: `386a10226570efe3572177718a9bca0f826cf6abc95ac91b63279a5993ae3dae`
- Signature: `evaluate(input: ModelRouteContext): Promise<ModelRouteDecision>`

