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
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...init,
    headers,
  });
  const payload: unknown = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new ManagementApiError(response.status, payload);
  return payload as T;
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
