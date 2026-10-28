import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNetworkPlan, marker } from './network-policy.mjs';
const network = 'site',
  bridge = 'br-123456789abc';
function fixture() {
  const service = (ip, ports = {}) => ({
    Id: 'id-' + ip,
    Image: 'image',
    State: { Running: true },
    NetworkSettings: { Networks: { site: { IPAddress: ip } }, Ports: ports },
  });
  return {
    config: {
      services: { runtime: 'runtime', postgres: 'postgres' },
      links: [{ from: 'runtime', to: 'postgres', port: 5432, network }],
      hostPorts: [{ role: 'runtime', port: 10998, network }],
    },
    containers: {
      runtime: service('10.0.0.2', { '10998/tcp': [{ HostIp: '127.0.0.1', HostPort: '10998' }] }),
      postgres: service('10.0.0.3'),
    },
    networks: { site: { Id: '123456789abcdef', Options: {} } },
  };
}
test('permits only declared service pairs and scoped loopback mapping', () => {
  const f = fixture(),
    p = buildNetworkPlan(f.config, f.containers, f.networks);
  assert.equal(p.rules.length, 4);
  assert.ok(p.rules.every((r) => r.args.includes(marker)));
  assert.deepEqual(p.routeLocalnetBridges, [bridge]);
  assert.ok(p.rules[0].args.includes('10.0.0.2/32'));
  assert.ok(p.rules[0].args.includes('10.0.0.3/32'));
  assert.ok(p.rules[1].args.includes('ESTABLISHED,RELATED'));
  assert.ok(p.rules[2].args.includes('127.0.0.1/32'));
});
test('resolves recreated containers and rejects stopped, missing, public or invalid endpoints', () => {
  const f = fixture();
  f.containers.runtime.NetworkSettings.Networks.site.IPAddress = '10.0.0.9';
  assert.ok(
    buildNetworkPlan(f.config, f.containers, f.networks).rules[2].args.includes('10.0.0.9:10998'),
  );
  f.containers.runtime.State.Running = false;
  assert.throws(() => buildNetworkPlan(f.config, f.containers, f.networks), /IDENTITY/);
  f.containers.runtime.State.Running = true;
  f.containers.runtime.NetworkSettings.Ports['10998/tcp'][0].HostIp = '0.0.0.0';
  assert.throws(() => buildNetworkPlan(f.config, f.containers, f.networks), /LOOPBACK/);
  f.config.links[0].port = 0;
  assert.throws(() => buildNetworkPlan(f.config, f.containers, f.networks), /PORT/);
});
