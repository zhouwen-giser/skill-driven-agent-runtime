# P01 冻结接口合同 V1.1

共享注册表：`../../shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json`
注册表 SHA-256：`d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`

## 消费接口

### BaselineGateResult
- Version: `1.1`
- Schema hash: `5aacbf026e86abc963544573d7cd45db971ecb160b9f310e063f8b73961e4135`
- Fields: `status`, `repository`, `baselineSha`, `v123FinalEvidenceRefs`, `fullVerifyStatus`, `migrationHead`, `openBlockers`

## 生产接口

### CompiledArtifactType
- Owner: `P01`
- Version: `1.1`
- Schema hash: `2dc5bd1322559c8ae0f5dabe945e69c01b6cb69ad379ceaa0f633f2e88072cea`
- Values: `intent_route`, `plan_template`, `decision_rule`, `case_template`, `model_route`

### CompiledArtifactStatus
- Owner: `P01`
- Version: `1.1`
- Schema hash: `266a7448640bf17113b431919c1fb6113b022e1b9d8a932b9443404f620c8ba5`
- Values: `discovered`, `candidate`, `validating`, `awaiting_approval`, `active`, `revalidating`, `deprecated`, `archived`, `rejected`

### CompiledArtifact
- Owner: `P01`
- Version: `1.1`
- Schema hash: `8afcafacad1085eb35d7b3fb0dd7715b05e7ff279f0d78b529a4b64fbe39bdcf`
- Fields: `artifactId`, `artifactKey`, `version`, `artifactType`, `name`, `description`, `scope`, `definition`, `applicability`, `requiredCapabilities`, `requiredPolicies`, `dependencySnapshot`, `riskLevel`, `status`, `lineageRef`, `validationSummaryRef`, `contentHash`, `createdAt`

### ArtifactApplicability
- Owner: `P01`
- Version: `1.1`
- Schema hash: `4af9af86a57212d4120637a0c97484890eb6c34e729fd7d90d6d893c32bf47c8`
- Fields: `requiredConditions`, `optionalConditions`, `forbiddenConditions`, `requiredParameters`, `allowedEnvironmentClasses`, `excludedEnvironmentClasses`, `minimumIntentScore`, `minimumConditionScore`, `maximumUncertainty`, `outOfDistributionPolicy`

### ArtifactDependencySnapshot
- Owner: `P01`
- Version: `1.1`
- Schema hash: `ab5eb452c0299802016cf8771536a2796cf656c8117a67d0a8c6158aca2e127a`
- Fields: `capabilityCatalogHash`, `policyVersionRefs`, `taskTypeVersionRefs`, `schemaVersionRefs`, `requiredSkillVersionRefs`, `compilerVersion`

### ConditionExpression
- Owner: `P01`
- Version: `1.1`
- Schema hash: `db033c6d65b1123fefd8185a8424eb6e227d8fea5978c599c48a7c835db5607e`
- Fields: `type`, `children`, `child`, `field`, `operator`, `value`
- Notes: all|any|not|atomic; active evaluation is deterministic

### IntentRouteArtifactDefinition
- Owner: `P01`
- Version: `1.1`
- Schema hash: `7a95d4c0620a5623725cb5672d22433a47981f8b239997a3e872a597378b8f7a`
- Fields: `taskTypeId`, `semanticExamples`, `exactPatterns`, `structuredHints`, `nextPath`

### PlanTemplateArtifactDefinition
- Owner: `P01`
- Version: `1.1`
- Schema hash: `b089d44944f3db3c5fcfff016a5b56f5d3482d89088448697b5cd4f20d425d04`
- Fields: `goalPattern`, `parameterSchema`, `parameterBindings`, `skillGoalGraph`, `completionContractTemplate`, `recoveryBranches`

### SkillGoalNodeTemplate
- Owner: `P01`
- Version: `1.1`
- Schema hash: `f8deaf1d8882195927d9c5070262fd14c8e894e084eaafc29e193dff8f3cb0a7`
- Fields: `nodeKey`, `nodeType`, `objectiveTemplate`, `requiredCapabilities`, `requiredEffectRefs`, `coveredCriterionTemplateIds`, `evidenceRequirements`, `artifactRequirements`, `inputTemplate`, `assumptionsAllowed`, `constraints`
- Notes: nodeType includes action|observation|reasoning|verification|recovery|human_gate

### DecisionRuleArtifactDefinition
- Owner: `P01`
- Version: `1.1`
- Schema hash: `5710c7a6e2aa4b76f19449776af894cf039140f3f35a88fc14525ecbef920e85`
- Fields: `category`, `condition`, `decision`, `priority`, `conflictGroup`, `conflictPolicy`

### DecisionOutput
- Owner: `P01`
- Version: `1.1`
- Schema hash: `e1b890a30d853179f36092c01e1404c5b811f1cc54a63b98bf3eef9045877dc9`
- Fields: `decisionType`, `parameters`, `explanationCode`

### CaseArtifactDefinition
- Owner: `P01`
- Version: `1.1`
- Schema hash: `c1b03024222e19ed2834e25accdb8e4d841ae3e2d35ea28ecba056a79d585ea5`
- Fields: `problemFingerprint`, `solutionPattern`, `adaptationRules`, `applicability`, `failureBoundaries`, `priorOutcomeSummary`

### ModelRouteArtifactDefinition
- Owner: `P01`
- Version: `1.1`
- Schema hash: `2f271f5b96f9d83675b2176ea8f7a8eea76a86f1e3cc5e52c255a42cb6016678`
- Fields: `conditions`, `route`, `budget`, `fallbackRoutes`

### ArtifactLineage
- Owner: `P01`
- Version: `1.1`
- Schema hash: `aa6629a29c59194e6584813656dd3a0b930da324f2a8e9e3002d9580310b6f57`
- Fields: `lineageId`, `artifactId`, `artifactVersion`, `sourceEpisodeRefs`, `sourceKnowledgeRefs`, `sourceCorrectionRefs`, `sourcePatternRefs`, `generationMethods`, `validationRunRefs`, `supersedesArtifactRefs`

### ArtifactRuntimeBinding
- Owner: `P01`
- Version: `1.1`
- Schema hash: `52a678f6ef4de068f780d94aad27bcb4ae080f1ab3351b64c0f608719ba3a337`
- Fields: `bindingId`, `artifactId`, `artifactVersion`, `runtimeType`, `compilerVersion`, `compiledPayloadHash`, `compiledAt`
