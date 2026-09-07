/** Inert UI demonstration. No transport, task, mission or hardware dependency exists here. */
export interface IsolatedDemoRecord {
  readonly requestId: string;
  readonly objectId: string;
  readonly state: 'active' | 'inactive';
  readonly phase: 'requested' | 'confirmed';
  readonly observedAt: string;
  readonly origin: 'manual_software_demo';
}

export interface IsolatedDemoAudit {
  append(record: IsolatedDemoRecord): Promise<void>;
  list(): Promise<readonly IsolatedDemoRecord[]>;
}

export class IsolatedDemoError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export class IsolatedDemoService {
  constructor(
    private readonly audit: IsolatedDemoAudit,
    private readonly now: () => string,
  ) {}

  async catalog() {
    return {
      schemaVersion: 'sdar.development.isolated-demo/v1',
      implementation: 'software_only',
      deviceExecution: 'disabled',
      disabledReason: 'DEVICE_EFFECTOR_EXECUTION_NOT_IMPLEMENTED',
      deviceCapability: 'vehicle.ugv.fire-weapon',
      deviceSkill: 'ugv.fire-weapon',
      executableCapability: null,
      manualConfirmationRequired: true,
      records: await this.audit.list(),
    } as const;
  }

  async request(
    input: Readonly<{ requestId: string; objectId: string; state: 'active' | 'inactive' }>,
  ) {
    const existing = (await this.audit.list()).find(
      (row) => row.requestId === input.requestId && row.phase === 'requested',
    );
    if (existing && (existing.objectId !== input.objectId || existing.state !== input.state))
      throw new IsolatedDemoError('SOFTWARE_DEMO_IDEMPOTENCY_CONFLICT');
    await this.audit.append({
      ...input,
      phase: 'requested',
      observedAt: this.now(),
      origin: 'manual_software_demo',
    });
    return this.catalog();
  }

  async confirm(requestId: string, acknowledgement: string) {
    if (acknowledgement !== 'software-only')
      throw new IsolatedDemoError('SOFTWARE_DEMO_MANUAL_ACK_REQUIRED');
    const request = (await this.audit.list()).find(
      (row) => row.requestId === requestId && row.phase === 'requested',
    );
    if (!request) throw new IsolatedDemoError('SOFTWARE_DEMO_REQUEST_NOT_FOUND');
    await this.audit.append({ ...request, phase: 'confirmed', observedAt: this.now() });
    return this.catalog();
  }
}
