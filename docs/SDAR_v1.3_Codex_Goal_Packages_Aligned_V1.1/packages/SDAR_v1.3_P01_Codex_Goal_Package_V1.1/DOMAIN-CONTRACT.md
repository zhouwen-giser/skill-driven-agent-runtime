# P01 Runtime Artifact Domain Contract V1.1

P01 必须原样实现共享注册表中的 `CompiledArtifact`。核心字段不得重命名：

```ts
interface CompiledArtifact {
  artifactId: string;
  artifactKey: string;
  version: number;
  artifactType: CompiledArtifactType;
  name: string;
  description: string;
  scope: { tenantId?: string; domain: string; taskTypeIds: string[] };
  definition: IntentRouteArtifactDefinition | PlanTemplateArtifactDefinition | DecisionRuleArtifactDefinition | CaseArtifactDefinition | ModelRouteArtifactDefinition;
  applicability: ArtifactApplicability;
  requiredCapabilities: CapabilityRequirement[];
  requiredPolicies: PolicyReference[];
  dependencySnapshot: ArtifactDependencySnapshot;
  riskLevel: "low" | "medium" | "high" | "critical";
  status: CompiledArtifactStatus;
  lineageRef: string;
  validationSummaryRef?: string;
  contentHash: string;
  createdAt: string;
}
```

状态固定为：`discovered → candidate → validating → awaiting_approval → active → revalidating → deprecated/archived/rejected`。

核心约束：

- Definition、Applicability、Dependency Snapshot、Validation、Approval、Active Pointer Transition 不可原地修改；
- Artifact 不直接调用 Skill/MCP；
- Artifact 不写 Goal Terminal / Outcome；
- Runtime Binding 是可重建投影；
- Active Definition 不允许无约束 `unknown`；
- JSON Schema、Zod/AJV、TypeScript 和 Golden Fixture 必须同源或相互校验。
