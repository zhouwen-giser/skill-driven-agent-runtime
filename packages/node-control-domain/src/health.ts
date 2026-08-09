export type NodeComponentStatus = 'healthy' | 'degraded' | 'unavailable' | 'disabled';
export type NodeHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'maintenance';

export interface NodeHealthComponent {
  readonly component: string;
  readonly status: NodeComponentStatus;
  readonly reasonCode?: string;
  readonly observedAt: string;
}

export interface NodeHealth {
  readonly nodeId: string;
  readonly status: NodeHealthStatus;
  readonly components: readonly NodeHealthComponent[];
  readonly activeTasks: number;
  readonly observedAt: string;
}

/**
 * Append-only Control PostgreSQL health authority. The runtime projects this fact and the related
 * frozen node.health.changed event; it never invents Control health state.
 */
export interface NodeHealthObservation extends NodeHealth {
  readonly observationId: string;
  /** Monotonic authority revision for this Node; unrelated to Evidence observationGeneration. */
  readonly observationRevision: number;
}

export interface NodeControlReadiness {
  readonly status: 'ready' | 'not_ready';
  readonly checks: readonly NodeHealthComponent[];
  readonly observedAt: string;
}
