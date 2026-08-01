import type {
  ControlAuditEvent,
  ManagementOperation,
  NodeProfile,
} from '../../node-control-domain/src/index.js';

export interface NodeControlFoundationRepository {
  migrate(): Promise<void>;
  probe(): Promise<boolean>;
  findNodeProfile(): Promise<NodeProfile | undefined>;
  bootstrapNodeProfile(profile: NodeProfile, audit: ControlAuditEvent): Promise<boolean>;
  listManagementOperations(limit: number): Promise<readonly ManagementOperation[]>;
  findManagementOperation(operationId: string): Promise<ManagementOperation | undefined>;
  listAuditEvents(limit: number): Promise<readonly ControlAuditEvent[]>;
}

export interface NodeControlClock {
  now(): string;
}

export interface NodeControlIdGenerator {
  next(): string;
}
