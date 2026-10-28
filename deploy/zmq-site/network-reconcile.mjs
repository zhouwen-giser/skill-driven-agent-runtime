import process from 'node:process';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildNetworkPlan } from './network-policy.mjs';
const [mode, configFile, stateDirectory, phase = 'full'] = process.argv.slice(2);
if (!['plan', 'apply', 'verify'].includes(mode) || !configFile || !stateDirectory)
  throw Error('USAGE: plan|apply|verify CONFIG STATE_DIRECTORY [database|full]');
const root = resolve(stateDirectory);
mkdirSync(root, { recursive: true, mode: 0o700 });
const docker = (args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const inspect = (name) => JSON.parse(docker(['inspect', name]))[0];
const configuration = JSON.parse(readFileSync(configFile, 'utf8'));
const containers = Object.fromEntries(
  Object.values(configuration.services).map((name) => [name, inspect(name)]),
);
const networkNames = new Set(
  [...configuration.links, ...configuration.hostPorts].map((v) => v.network),
);
const networks = Object.fromEntries([...networkNames].map((name) => [name, inspect(name)]));
const plan = buildNetworkPlan(configuration, containers, networks, phase);
const planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
const prefix = join(root, `${new Date().toISOString().replaceAll(':', '-')}-${mode}`);
writeFileSync(prefix + '-plan.json', JSON.stringify(plan, null, 2) + '\n', { mode: 0o600 });
if (mode === 'plan') {
  console.log(JSON.stringify({ planHash, plan }));
  process.exit(0);
}
const helper = join(root, 'network-reconcile.py');
writeFileSync(
  helper,
  `import subprocess,json,shlex,sys,datetime\nmode,planfile=sys.argv[1:3]\nplan=json.load(open(planfile))\nbinary='/usr/sbin/iptables-nft'\ndef run(args,check=True):\n return subprocess.run(args,text=True,capture_output=True,check=check)\ndef snapshot():\n return {b+'-'+t:run(['/usr/sbin/'+b+'-save','-t',t]).stdout for b in ['iptables-nft','iptables-legacy'] for t in ['filter','nat']}\nbefore=snapshot()\nif ':DOCKER-USER ' not in before['iptables-nft-filter']:\n raise Exception('NFT_DOCKER_BACKEND_REQUIRED')\nchanges=[]\nif mode=='apply':\n for r in plan['rules']:\n  base=[binary,'-w','5','-t',r['table']]\n  if run(base+['-C',r['chain']]+r['args'],False).returncode:\n   run(base+['-I',r['chain'],'1']+r['args']);changes.append('add')\n # Remove only obsolete rules owned by this reconciler after all replacements exist.\n for table,chain in [('filter','DOCKER-USER'),('nat','OUTPUT'),('nat','POSTROUTING')]:\n  base=[binary,'-w','5','-t',table]\n  for line in run(base+['-S',chain]).stdout.splitlines():\n   parts=shlex.split(line)\n   if parts[:2]!=['-A',chain] or plan['marker'] not in parts:continue\n   # iptables -S normalizes arguments. Compare using -C for desired rules and -S canonical form.\n   wanted=False\n   for r in plan['rules']:\n    if r['table']!=table or r['chain']!=chain:continue\n    # Preserve matching endpoint tuples and target; canonical ordering is kernel owned.\n    tokens=r['args']; keys=['-s','-d','-i','-o','--dport','--sport','--to-destination','-j']\n    if all((k in tokens)==(k in parts) and (k not in tokens or tokens[tokens.index(k)+1]==parts[parts.index(k)+1]) for k in keys):wanted=True;break\n   if not wanted:run(base+['-D',chain]+parts[2:]);changes.append('remove_owned_obsolete')\nfor r in plan['rules']:\n run([binary,'-w','5','-t',r['table'],'-C',r['chain']]+r['args'])\nprint(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'verified','changes':changes,'before':before,'after':snapshot()}))\n`,
  { mode: 0o600 },
);
const routeLocalnet = [];
for (const bridge of plan.routeLocalnetBridges) {
  const path = `/proc/sys/net/ipv4/conf/${bridge}/route_localnet`;
  const before = readFileSync(path, 'utf8').trim();
  if (mode === 'apply' && before !== '1')
    docker([
      'run',
      '--rm',
      '--network',
      'host',
      '--cap-add',
      'NET_ADMIN',
      '--user',
      '0',
      '--mount',
      `type=bind,source=${path},target=/run/route-localnet`,
      'node:22-bookworm-slim',
      'node',
      '-e',
      "require('fs').writeFileSync('/run/route-localnet','1')",
    ]);
  const after = readFileSync(path, 'utf8').trim();
  routeLocalnet.push({ bridge, before, after });
  if (after !== '1') throw Error('NETWORK_ROUTE_LOCALNET_NOT_ENABLED');
}
const receipt = JSON.parse(
  docker([
    'run',
    '--rm',
    '--network',
    'host',
    '--cap-add',
    'NET_ADMIN',
    '--user',
    '0',
    '--mount',
    'type=bind,source=/,target=/host,readonly',
    'node:22-bookworm-slim',
    'chroot',
    '/host',
    '/usr/bin/python3',
    helper,
    mode,
    prefix + '-plan.json',
  ]),
);
writeFileSync(
  prefix + '-receipt.json',
  JSON.stringify({ ...receipt, planHash, routeLocalnet }, null, 2) + '\n',
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    status: receipt.status,
    planHash,
    ruleCount: plan.rules.length,
    changes: receipt.changes,
    evidence: prefix + '-receipt.json',
  }),
);
