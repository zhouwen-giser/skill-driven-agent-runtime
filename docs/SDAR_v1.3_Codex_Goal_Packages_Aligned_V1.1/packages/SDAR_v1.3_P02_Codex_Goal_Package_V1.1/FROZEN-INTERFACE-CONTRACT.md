# P02 冻结接口合同 V1.1

共享注册表：`../../shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json`
注册表 SHA-256：`d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`

## 消费接口

### CompiledArtifact
- Version: `1.1`
- Schema hash: `8afcafacad1085eb35d7b3fb0dd7715b05e7ff279f0d78b529a4b64fbe39bdcf`
- Fields: `artifactId`, `artifactKey`, `version`, `artifactType`, `name`, `description`, `scope`, `definition`, `applicability`, `requiredCapabilities`, `requiredPolicies`, `dependencySnapshot`, `riskLevel`, `status`, `lineageRef`, `validationSummaryRef`, `contentHash`, `createdAt`

### ArtifactLineage
- Version: `1.1`
- Schema hash: `aa6629a29c59194e6584813656dd3a0b930da324f2a8e9e3002d9580310b6f57`
- Fields: `lineageId`, `artifactId`, `artifactVersion`, `sourceEpisodeRefs`, `sourceKnowledgeRefs`, `sourceCorrectionRefs`, `sourcePatternRefs`, `generationMethods`, `validationRunRefs`, `supersedesArtifactRefs`

### ArtifactRuntimeBinding
- Version: `1.1`
- Schema hash: `52a678f6ef4de068f780d94aad27bcb4ae080f1ab3351b64c0f608719ba3a337`
- Fields: `bindingId`, `artifactId`, `artifactVersion`, `runtimeType`, `compilerVersion`, `compiledPayloadHash`, `compiledAt`

## 生产接口

### ArtifactRepository
- Owner: `P02`
- Version: `1.1`
- Schema hash: `617560087d746b79cd5fa38f82bf8c7a90448f56e5b54c1117f0b186bae54c53`
- Signature: `findActiveIndex(query); getDefinition(ref); saveCandidate(candidate); activate(input); deprecate(input)`

### ArtifactValidationRepository
- Owner: `P02`
- Version: `1.1`
- Schema hash: `0c94dc844ed8cf5f4e9e4ca678e208172cd3a394affbf93ce910765899f86ab9`
- Signature: `createRun(input); appendResult(input); findPromotionSummary(ref)`

### ArtifactExecutionRepository
- Owner: `P02`
- Version: `1.1`
- Schema hash: `c32e0994dd2d25cbe5df2116e98b0c93252d5a75bb5e83867c25038fcec12650`
- Signature: `start(input); complete(input); appendFeedback(input)`

### ArtifactRegistryService
- Owner: `P02`
- Version: `1.1`
- Schema hash: `011be4e2c1686e0f68256aa9c4cf9f98dff2d92fcb4cf043b2d09b06a0c7cab5`
- Signature: `createCandidate; getVersion; queryActiveIndex; invalidateDependency; rebuildProjection`

### OperatorIdentityPort
- Owner: `P02`
- Version: `1.1`
- Schema hash: `1ec57c600b439bcd1efe67c67ee319b04f38681e2ab3da6fad71dbae734dfe75`
- Signature: `requireIdentity; requirePermission; getTenantScope`

### ArtifactGovernancePort
- Owner: `P02`
- Version: `1.1`
- Schema hash: `991d8aeb156f03d07b6181ac2d1d097f78633cf7988a93336b61815e8c3b74cf`
- Signature: `requestValidation; recordApproval; activate; requestRevalidation; deprecate; rollback; killSwitch`

