import process from 'node:process';
import { URL } from 'node:url';
// Isolated cross-repository test adapter. Every command endpoint is allocated by the loopback fixture.
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
const c = z
  .object({
    owner: z.literal('zmq-phase5-governance'),
    databaseUrl: z.url(),
    simulationId: z.string(),
    evidenceFile: z.string(),
  })
  .strict()
  .parse(JSON.parse(await readFile(process.env.SMPP_ZMQ_GOVERNANCE_FIXTURE_CONFIG, 'utf8')));
const source = await realpath(process.env.SMPP_ZMQ_SOURCE_ROOT);
if (
  new URL(c.databaseUrl).hostname !== '127.0.0.1' ||
  new URL(c.databaseUrl).pathname !== '/zmq_governance' ||
  JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8')).name !==
    'sdar-mcp-provider-platform' ||
  !process.send
)
  throw Error('OWNED_SITE_FIXTURE_REQUIRED');
process.chdir(source);
const load = (path) => import(pathToFileURL(resolve(source, path)).href);
const { controlSiteFixture } = await load('tests/ugv-zmq-provider/site-control-fixture.ts');
const { emptyReport } = await load('tests/ugv-zmq-observer/helpers.ts');
const { until } = await load('tests/ugv-zmq-control-postgres/harness.ts');
const f = await controlSiteFixture(c.databaseUrl, 'site_anonymous');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await writeFile(
    c.evidenceFile,
    JSON.stringify(
      {
        classification: 'ISOLATED_SITE_CONTROL_WIRE_SIMULATOR',
        commands: f.devices.commands,
        errors: f.devices.errors,
        executions: (await f.provider.store.pool.query('SELECT payload FROM ugv_execution')).rows,
        runtimeTasks: (
          await f.runtime.pool.query(
            'SELECT task_id,external_execution_id,internal_state,mcp_status,status_message FROM provider_task',
          )
        ).rows,
        rawChassisFrames: f.devices.rawChassisFrames.map((b) => b.toString('base64')),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await f.close();
}
process.send({
  ready: true,
  endpoint: f.mcp.url,
  providerId: f.profile.providerBinding.providerId,
  resourceId: f.resourceId,
  simulationId: null,
});
let tail = Promise.resolve();
process.on('message', (value) => {
  tail = tail
    .then(async () => {
      const m = z
        .object({
          id: z.string(),
          action: z.enum(['inspect', 'complete', 'finish', 'fail', 'stop', 'status']),
          report: z.enum(['empty', 'missing']).optional(),
        })
        .strict()
        .parse(value);
      try {
        if (m.action === 'stop') {
          await close();
          process.send?.({ id: m.id, result: 'stopped' });
          process.disconnect?.();
          return;
        }
        if (m.action === 'inspect') {
          await until(async () =>
            (await f.provider.repository.pending()).some(
              (e) => e.state === 'RUNNING' && e.operationName === 'vehicle_zmq_inspect_area',
            ),
          );
          const e = (await f.provider.repository.pending()).find(
            (e) => e.operationName === 'vehicle_zmq_inspect_area',
          );
          if (!e?.zmqControl) throw Error('OWNED_INSPECTION_REQUIRED');
          if (m.report !== 'missing') {
            const report = emptyReport({
              task_id: e.zmqControl.nativeTaskId,
              observed_at_utc_ms: Date.now(),
            });
            // A new simulated acquisition has its own frame identity. Reusing frame-1
            // across tasks correctly triggers the receiver's conflict/replay guard.
            report.image = { ...report.image, frame_id: 'inspection-' + e.taskId };
            await f.devices.publishReport('targetlist', report);
            await until(
              async () =>
                (await f.provider.repository.get(e.taskId))?.zmqInspection?.targetReportCount === 1,
            );
          }
          f.devices.completeRecon();
        }
        if (m.action === 'finish') f.devices.completeNavigation();
        if (m.action === 'complete') f.devices.completeRecon();
        if (m.action === 'fail') {
          if (f.devices.moving) {
            f.devices.missionState = 5;
            f.devices.moving = false;
          } else {
            f.devices.taskState = 'failed';
            f.devices.eoDevice = {
              ...f.devices.eoDevice,
              mode: 'idle',
              ready: true,
              active_task_id: null,
            };
          }
          await f.devices.publish();
        }
        process.send?.({
          id: m.id,
          result: {
            commands: f.devices.commands.length,
            chassisMotionDispatches: f.devices.commands.filter(
              (command) =>
                command.component === 'chassis' &&
                ['targetPoint', 'pathFollow', 'returnHome'].includes(String(command.request.type)),
            ).length,
            runtimeTasks: (
              await f.runtime.pool.query(
                'SELECT task_id,external_execution_id,internal_state,mcp_status,status_message FROM provider_task',
              )
            ).rows,
            active: (await f.provider.repository.pending()).map((e) => ({
              taskId: e.taskId,
              state: e.state,
              operationName: e.operationName,
            })),
          },
        });
      } catch (error) {
        process.send?.({
          id: m.id,
          error: error instanceof Error ? error.message : 'OWNED_FIXTURE_FAILED',
        });
      }
    })
    .catch((error) => {
      process.stderr.write(String(error) + '\n');
      process.exitCode = 1;
    });
});
process.on('disconnect', () => {
  void close().catch(() => {
    process.exitCode = 1;
  });
});
