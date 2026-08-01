export class ManagementApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly payload: unknown,
  ) {
    super(`Management API request failed with ${String(status)}`);
    this.name = 'ManagementApiError';
  }
}

export async function managementRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  const bearerToken = managementBearerToken();
  if (bearerToken !== undefined) headers.set('Authorization', `Bearer ${bearerToken}`);
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...init,
    headers,
  });
  const payload: unknown = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new ManagementApiError(response.status, payload);
  return payload as T;
}

export interface ArtifactRuntimeEvidence {
  readonly requestRef: string;
  readonly case?: unknown;
  readonly modelRoute?: unknown;
}

export function getArtifactRuntimeEvidence(requestRef: string): Promise<ArtifactRuntimeEvidence> {
  return managementRequest(`/api/v1/artifacts/runtime-evidence/${encodeURIComponent(requestRef)}`);
}

export interface ArtifactManagementItem {
  readonly artifact_id: string;
  readonly artifact_key: string;
  readonly version: number;
  readonly artifact_type: string;
  readonly status: string;
  readonly risk_level: string;
  readonly validation_status?: string;
  readonly active_pointer_version?: number;
}

export function listArtifacts(query: {
  readonly limit: number;
  readonly sort: 'created_desc' | 'created_asc' | 'key_asc';
  readonly cursor?: string;
  readonly status?: string;
  readonly type?: string;
  readonly risk?: string;
}): Promise<{ readonly items: readonly ArtifactManagementItem[]; readonly nextCursor?: string }> {
  const parameters = new URLSearchParams({
    limit: String(query.limit),
    sort: query.sort,
  });
  if (query.cursor !== undefined) parameters.set('cursor', query.cursor);
  if (query.status !== undefined && query.status !== '') parameters.set('status', query.status);
  if (query.type !== undefined && query.type !== '') parameters.set('type', query.type);
  if (query.risk !== undefined && query.risk !== '') parameters.set('risk', query.risk);
  return managementRequest(`/api/v1/artifacts?${parameters.toString()}`);
}

export function getArtifact(artifactId: string): Promise<unknown> {
  return managementRequest(`/api/v1/artifacts/${encodeURIComponent(artifactId)}`);
}

export function getArtifactView(artifactId: string, view: string): Promise<unknown> {
  return managementRequest(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/${encodeURIComponent(view)}`,
  );
}

export function getArtifactRuntimeView(
  view: 'decisions' | 'model-usage' | 'case-usage',
): Promise<Readonly<{ items: readonly unknown[]; nextCursor?: string }>> {
  return managementRequest(`/api/v1/runtime/${encodeURIComponent(view)}?limit=50`);
}

export function artifactCommand(
  artifactId: string,
  operation: string,
  input: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return managementRequest(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/commands/${encodeURIComponent(operation)}`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function setManagementBearerToken(token: string): void {
  const storage = browserSessionStorage();
  if (storage === undefined) return;
  const normalized = token.trim();
  if (normalized === '') storage.removeItem('sdar.managementBearerToken');
  else storage.setItem('sdar.managementBearerToken', normalized);
}

function managementBearerToken(): string | undefined {
  const token = browserSessionStorage()?.getItem('sdar.managementBearerToken')?.trim();
  return token === undefined || token === '' ? undefined : token;
}

function browserSessionStorage():
  | Readonly<{
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      removeItem(key: string): void;
    }>
  | undefined {
  const candidate = (globalThis as Readonly<{ sessionStorage?: unknown }>).sessionStorage;
  return typeof candidate === 'object' && candidate !== null
    ? (candidate as Readonly<{
        getItem(key: string): string | null;
        setItem(key: string, value: string): void;
        removeItem(key: string): void;
      }>)
    : undefined;
}

export interface HealthPayload {
  readonly status: string;
  readonly warning: string;
  readonly historicalDataRetention?: Readonly<{
    default: 'indefinite';
    automaticArchive: false;
    automaticDelete: false;
    policyFieldsAreAdvisory: true;
  }>;
}

export interface SkillSummary {
  readonly id?: string;
  readonly skillId?: string;
  readonly name?: string;
  readonly status?: string;
  readonly enabled?: boolean;
  readonly version?: string | number;
}

export interface McpServerSummary {
  readonly id?: string;
  readonly serverId?: string;
  readonly name?: string;
  readonly status?: string;
  readonly enabled?: boolean;
}

export interface EvaluationAnalytics {
  readonly success?: unknown;
  readonly duration?: unknown;
  readonly cost?: unknown;
  readonly failureTypes?: unknown;
  readonly versionStability?: unknown;
  readonly qualityTrend?: unknown;
}
