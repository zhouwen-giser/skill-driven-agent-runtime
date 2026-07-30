export const MANAGEMENT_API_CONTRACT_SCHEMA_HASH =
  '842c040064b7171337082d865d4b46cbc27c8063ab3b0a3f881f4458247e8cbe' as const;
export const A2A_ARTIFACT_PROJECTION_SCHEMA_HASH =
  'bdf152659c84b4fbbcb7d1d9dd47b97aedf73f5e82c55265a796ec4fd406d0ff' as const;
export const SSE_ARTIFACT_EVENT_PROJECTION_SCHEMA_HASH =
  'c9c2b763d109005241827ddb1cb957e28fcf7003a759d387f0888a85700f7380' as const;

export interface ManagementApiContract {
  readonly queryOperations: readonly string[];
  readonly commandOperations: readonly string[];
  readonly pagination: 'cursor';
  readonly filters: readonly string[];
  readonly expectedVersion: true;
  readonly idempotency: true;
  readonly rbac: true;
  readonly tenant: true;
  readonly redaction: true;
  readonly openapiVersion: '3.1.0';
}

export interface A2AArtifactProjection {
  readonly publicCapabilitySummary: readonly string[];
  readonly inputRequired: boolean;
  readonly confirmation: boolean;
  readonly formalTaskState: string;
  readonly safeEvidence: Readonly<Record<string, string | number | boolean | null>>;
  readonly redactionPolicyVersion: 'artifact-exposure/1.1';
}

export interface SseArtifactEventProjection {
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly safePayload: Readonly<Record<string, unknown>>;
  readonly sourceRef: string;
  readonly createdAt: string;
}
