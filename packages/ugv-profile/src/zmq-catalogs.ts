import controlV13 from './zmq-site-control-v13-catalog.json' with { type: 'json' };
import isolated from './zmq-catalog-contract.json' with { type: 'json' };
import readonly from './zmq-site-catalog.json' with { type: 'json' };
import control from './zmq-site-control-catalog.json' with { type: 'json' };
export type ZmqCatalogProfile =
  | 'zmq_v1_0_1_12'
  | 'zmq_v1_1_0_readonly_13'
  | 'zmq_v1_2_0_site_control_13'
  | 'zmq_v1_3_0_site_control_13';
export type ZmqSiteCatalogProfile = Exclude<ZmqCatalogProfile, 'zmq_v1_0_1_12'>;
export interface ReviewedZmqTool {
  readonly name: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly _meta: Readonly<Record<string, unknown>>;
}
export function reviewedZmqCatalog(profile: string): {
  readonly profile: string;
  readonly tools: readonly ReviewedZmqTool[];
} {
  if (profile === 'zmq_v1_0_1_12') return isolated;
  if (profile === 'zmq_v1_1_0_readonly_13') return readonly;
  if (profile === 'zmq_v1_2_0_site_control_13') return control;
  if (profile === 'zmq_v1_3_0_site_control_13') return controlV13;
  throw Error('ZMQ_CATALOG_PROFILE_UNREVIEWED');
}
