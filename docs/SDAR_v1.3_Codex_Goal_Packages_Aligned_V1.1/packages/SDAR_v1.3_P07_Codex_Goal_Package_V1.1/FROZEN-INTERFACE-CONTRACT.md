# P07 冻结接口合同 V1.1

共享注册表：`../../shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json`
注册表 SHA-256：`d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`

## 消费接口

### CompiledArtifact
- Version: `1.1`
- Schema hash: `8afcafacad1085eb35d7b3fb0dd7715b05e7ff279f0d78b529a4b64fbe39bdcf`
- Fields: `artifactId`, `artifactKey`, `version`, `artifactType`, `name`, `description`, `scope`, `definition`, `applicability`, `requiredCapabilities`, `requiredPolicies`, `dependencySnapshot`, `riskLevel`, `status`, `lineageRef`, `validationSummaryRef`, `contentHash`, `createdAt`

### ArtifactActivationRecord
- Version: `1.1`
- Schema hash: `d45959a850c3433df4be744f77e758209e317ceb88c5dc816d448878b2e3a7ef`
- Fields: `activationId`, `artifactRef`, `artifactHash`, `approvalRef`, `approvalHash`, `previousActiveArtifactRef`, `activePointerVersion`, `activatedBy`, `activatedAt`

### ArtifactRepository
- Version: `1.1`
- Schema hash: `617560087d746b79cd5fa38f82bf8c7a90448f56e5b54c1117f0b186bae54c53`
- Signature: `findActiveIndex(query); getDefinition(ref); saveCandidate(candidate); activate(input); deprecate(input)`

## 生产接口

### ArtifactIndexEntry
- Owner: `P07`
- Version: `1.1`
- Schema hash: `dd7bc4378007ad394fa1905aebc529b30f24fc279857ba67605f29036afe9bf0`
- Fields: `artifactRef`, `artifactKey`, `artifactVersion`, `artifactType`, `tenantId`, `domain`, `taskTypeIds`, `riskLevel`, `status`, `exactPatterns`, `structuredHints`, `embeddingRef`, `activePointerVersion`, `contentHash`

### ArtifactMatchScore
- Owner: `P07`
- Version: `1.1`
- Schema hash: `73ddec591cef1fc8e4b4d25d5cf20e7f64523e1ca66a24ca86db32ba8ed18bc5`
- Fields: `intentScore`, `structuredConditionScore`, `parameterCoverageScore`, `capabilityShapeScore`, `environmentSimilarityScore`, `validationConfidenceScore`, `recentReliabilityScore`, `riskPenalty`, `totalScore`

### ArtifactMatch
- Owner: `P07`
- Version: `1.1`
- Schema hash: `7334e4ba7c70f3744b81bb14bef308ca5abd32c6b99f7f05bf0d210b2d7267d7`
- Fields: `artifactRef`, `rank`, `score`, `retrievalSources`, `reasonCodes`

### ArtifactApplicabilityResult
- Owner: `P07`
- Version: `1.1`
- Schema hash: `0f87d569e3a38dc37526077d92040e1db7c745120c56ec7a79430d369265ec81`
- Fields: `applicable`, `confidence`, `satisfiedConditionIds`, `missingConditionIds`, `violatedConditionIds`, `uncertainConditionIds`, `outOfDistribution`, `disposition`

### ParameterBindingResult
- Owner: `P07`
- Version: `1.1`
- Schema hash: `13eaeb0cad67bd18fc3b83d9bf2315d6c72213602260c5f5898c419b4c9891a5`
- Fields: `artifactRef`, `bindings`, `missingRequiredParameters`, `rejectedCandidateBindings`, `requiresConfirmation`

### DependencyValidationResult
- Owner: `P07`
- Version: `1.1`
- Schema hash: `1a8a8c2c0f3001fdda76864c4029b3bb30193ecf4487e02b361c1ec1d6485470`
- Fields: `artifactRef`, `valid`, `mismatches`, `snapshotHash`, `reasonCodes`

### CapabilityReadinessResult
- Owner: `P07`
- Version: `1.1`
- Schema hash: `d1715f16e6faddabc1967207e4abd5b2c94f6fa92d2c7e51024e747b9d475fa4`
- Fields: `artifactRef`, `requiredCapabilities`, `skillCandidateRefs`, `providerReadiness`, `valid`, `reasonCodes`

### RuntimeExecutionDecision
- Owner: `P07`
- Version: `1.1`
- Schema hash: `4ad37edc562bf39d27982f23f70d27ee8af1a3dfe3486dfc34725eec62b5b4de`
- Fields: `decisionId`, `requestId`, `path`, `selectedArtifactRef`, `parameterBindings`, `missingParameters`, `requiredConfirmations`, `reasonCodes`, `matcherSnapshotHash`, `policySnapshotHash`, `createdAt`

### FastGatewayPath
- Owner: `P07`
- Version: `1.1`
- Schema hash: `af5fb1fd8fd79ea3b56580dbc1d073bb9e0ad8dd3b568fba2fecf1bb59f1e24b`
- Values: `compiled_fast`, `template_adapt`, `case_adapt`, `small_model`, `cognitive_runtime`, `human_input`, `denied`

