import process from 'node:process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ZmqSiteConfiguration } from '../../dist/apps/node-control-acceptance/src/zmq-site-config.js';
import { governSiteZmqSkills } from '../../dist/apps/node-control-acceptance/src/zmq-skill-governance.js';
import { renewZmqSiteBinding } from '../../dist/apps/node-control-acceptance/src/zmq-site-renewal.js';
import { ZmqSiteAuthoritySchema } from '../../dist/packages/ugv-profile/src/zmq-site-profile.js';
const [mode, configFile, receiptFile] = process.argv.slice(2);
if (
  !['govern', 'renew', 'renew-loop'].includes(mode) ||
  !configFile ||
  !receiptFile ||
  process.argv.length !== 5
)
  throw Error('ZMQ_SITE_GOVERNANCE_ARGUMENTS_INVALID');
if ((await stat(configFile)).mode & 0o077) throw Error('ZMQ_SITE_PRIVATE_CONFIGURATION_REQUIRED');
const config = ZmqSiteConfiguration.parse(JSON.parse(await readFile(configFile, 'utf8')));
const controller = new globalThis.AbortController();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => controller.abort());
async function save(value) {
  await writeFile(resolve(receiptFile), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
if (mode === 'govern') {
  const receipt = await governSiteZmqSkills(config);
  await save(receipt);
  process.stdout.write(
    JSON.stringify({
      status: 'published',
      count: receipt.published.length,
      physicalToolInvocationCount: 0,
    }) + '\n',
  );
} else {
  const previous = JSON.parse(await readFile(receiptFile, 'utf8'));
  let authority = ZmqSiteAuthoritySchema.parse(previous.authority);
  do {
    try {
      const receipt = await renewZmqSiteBinding(config, authority);
      authority = receipt.authority;
      await save({ ...previous, authority, renewal: receipt, renewedAt: new Date().toISOString() });
      process.stdout.write(
        JSON.stringify({
          status: 'renewed',
          validUntil: authority.validUntil,
          physicalToolInvocationCount: 0,
        }) + '\n',
      );
    } catch (error) {
      const reason =
        error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : 'ZMQ_SITE_RENEWAL_FAILED';
      process.stderr.write(
        JSON.stringify({ status: 'admission_blocked', reason, physicalToolInvocationCount: 0 }) +
          '\n',
      );
      if (mode === 'renew') process.exitCode = 1;
    }
    if (mode !== 'renew-loop' || controller.signal.aborted) break;
    await delay(60000, undefined, { signal: controller.signal }).catch((error) => {
      if (error?.name !== 'AbortError') throw error;
    });
  } while (!controller.signal.aborted);
}
