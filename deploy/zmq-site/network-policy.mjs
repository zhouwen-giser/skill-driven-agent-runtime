import { isIP } from 'node:net';

export const marker = 'sdar-zmq-site-network-v1';
const port = (v) => Number.isInteger(v) && v > 0 && v <= 65535;
export function buildNetworkPlan(configuration, containers, networks, phase = 'full') {
  if (!['database', 'full'].includes(phase)) throw Error('NETWORK_PHASE_INVALID');
  const rules = [],
    identities = [],
    bridges = new Set();
  const rule = (table, chain, args) =>
    rules.push({ table, chain, args: [...args, '-m', 'comment', '--comment', marker] });
  const endpoint = (role, network) => {
    const c = containers[configuration.services[role]],
      n = networks[network];
    const ip = c?.NetworkSettings?.Networks?.[network]?.IPAddress;
    const bridge = n?.Options?.['com.docker.network.bridge.name'] ?? `br-${n?.Id?.slice(0, 12)}`;
    if (!c?.State?.Running || isIP(ip ?? '') !== 4 || !/^br-[a-f0-9]{12}$/.test(bridge))
      throw Error('NETWORK_SERVICE_IDENTITY_INVALID');
    const identity = { role, containerId: c.Id, image: c.Image, network, ip, bridge };
    if (!identities.some((v) => v.containerId === c.Id && v.network === network))
      identities.push(identity);
    return identity;
  };
  for (const link of configuration.links) {
    if (!port(link.port)) throw Error('NETWORK_PORT_INVALID');
    if (phase === 'database' && link.to !== 'postgres') continue;
    const a = endpoint(link.from, link.network),
      b = endpoint(link.to, link.network);
    rule('filter', 'DOCKER-USER', [
      '-i',
      a.bridge,
      '-o',
      b.bridge,
      '-s',
      `${a.ip}/32`,
      '-d',
      `${b.ip}/32`,
      '-p',
      'tcp',
      '--dport',
      String(link.port),
      '-j',
      'ACCEPT',
    ]);
    rule('filter', 'DOCKER-USER', [
      '-i',
      b.bridge,
      '-o',
      a.bridge,
      '-s',
      `${b.ip}/32`,
      '-d',
      `${a.ip}/32`,
      '-p',
      'tcp',
      '--sport',
      String(link.port),
      '-m',
      'conntrack',
      '--ctstate',
      'ESTABLISHED,RELATED',
      '-j',
      'ACCEPT',
    ]);
  }
  for (const published of configuration.hostPorts) {
    if (!port(published.port)) throw Error('NETWORK_PORT_INVALID');
    const e = endpoint(published.role, published.network),
      c = containers[configuration.services[published.role]];
    const declared = c.NetworkSettings.Ports[`${published.port}/tcp`];
    if (!declared?.some((p) => p.HostIp === '127.0.0.1' && p.HostPort === String(published.port)))
      throw Error('NETWORK_LOOPBACK_PUBLISH_REQUIRED');
    bridges.add(e.bridge);
    rule('nat', 'OUTPUT', [
      '-d',
      '127.0.0.1/32',
      '-p',
      'tcp',
      '--dport',
      String(published.port),
      '-j',
      'DNAT',
      '--to-destination',
      `${e.ip}:${published.port}`,
    ]);
    rule('nat', 'POSTROUTING', [
      '-s',
      '127.0.0.0/8',
      '-d',
      `${e.ip}/32`,
      '-p',
      'tcp',
      '--dport',
      String(published.port),
      '-j',
      'MASQUERADE',
    ]);
  }
  return {
    schemaVersion: 'sdar.site-network-plan/1',
    marker,
    phase,
    identities,
    routeLocalnetBridges: [...bridges].sort(),
    rules,
  };
}
