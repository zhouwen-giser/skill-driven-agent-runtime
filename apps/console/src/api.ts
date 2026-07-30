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
