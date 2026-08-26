// Executed through stdin inside the existing SMPP Adapter container (/app).
// DescribeProvider reads the local manifest; it never dispatches Device tools.
import { setTimeout as pause } from 'node:timers/promises';
import process from 'node:process';

const { GrpcAdapterGateway } = await import('./dist/packages/adapter-protocol/src/index.js');
const gateway = new GrpcAdapterGateway({
  endpoint: '127.0.0.1:7010',
  providerId: 'isr.vehicle.ugv.ugv1',
  timeoutMs: 3000,
});
const expected = [
  'vehicle_area_recon',
  'vehicle_control_gimbal',
  'vehicle_emergency_stop',
  'vehicle_fire_weapon',
  'vehicle_get_capabilities',
  'vehicle_get_payload_status',
  'vehicle_get_state',
  'vehicle_get_targets',
  'vehicle_navigate',
  'vehicle_track_target',
].sort();
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const manifest = await gateway.describeProvider();
    const names = manifest.operations.map((operation) => operation.name).sort();
    if (
      manifest.providerId === 'isr.vehicle.ugv.ugv1' &&
      JSON.stringify(names) === JSON.stringify(expected)
    ) {
      ready = true;
      break;
    }
    await pause(1000);
  }
  if (!ready) throw new Error('UGV_DEBUG_PROVIDER_CATALOG_NOT_READY');
  process.stdout.write(
    JSON.stringify({ status: 'catalog_ready', operationCount: 10, deviceToolCalls: 0 }) + '\n',
  );
} finally {
  gateway.close();
}
