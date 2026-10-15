import pathlib,json,subprocess,sys,time,os,datetime
repo=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1');r=repo/'reports/inspection-area-v1';run,receipt,report=sys.argv[1:];settings=json.loads((r/'PERFORMANCE_CPU_AFFINITY.json').read_text());host=set(settings['hostCpus']);db=','.join(map(str,settings['databaseCpus']));project=run+'-e2e-performance';result={'status':'WAITING','runId':run,'project':project,'hostCpus':sorted(host),'databaseCpus':settings['databaseCpus'],'ownedContainers':{},'ownedTestProcesses':{},'testsChanged':False,'thresholdsChanged':False};end=time.monotonic()+3000
while time.monotonic()<end:
 ids=subprocess.check_output(['docker','ps','-aq','--filter','label=com.docker.compose.project='+project],text=True).split()
 for cid in ids:
  if cid in result['ownedContainers']:continue
  try:row=json.loads(subprocess.check_output(['docker','inspect',cid]))[0]
  except subprocess.CalledProcessError:continue
  assert row['Config']['Labels']['com.docker.compose.project']==project
  assert row['Config']['Labels']['com.docker.compose.service'] in ['postgres','redis']
  subprocess.run(['docker','update','--cpuset-cpus',db,cid],check=True,stdout=subprocess.DEVNULL)
  after=json.loads(subprocess.check_output(['docker','inspect',cid]))[0];assert after['HostConfig']['CpusetCpus']==db
  result['ownedContainers'][cid]={'name':after['Name'].lstrip('/'),'beforeCpuset':row['HostConfig']['CpusetCpus'],'cpuset':db}
 if result['ownedContainers']:
  process={};roots=[]
  for p in pathlib.Path('/proc').iterdir():
   if not p.name.isdigit():continue
   try:
    stat=(p/'stat').read_text();ppid=int(stat[stat.rfind(')')+2:].split()[1]);process[int(p.name)]=ppid
    command=(p/'cmdline').read_bytes().split(b'\0')
    if any(x.endswith(b'scripts/test-e2e.mjs') for x in command) and ('SDAR_VERIFY_COMPOSE_PROJECT='+run).encode() in (p/'environ').read_bytes().split(b'\0'):roots.append(int(p.name))
   except (OSError,ValueError,IndexError):pass
  selected=set(roots)
  while True:
   children={pid for pid,ppid in process.items() if ppid in selected};new=children-selected
   if not new:break
   selected.update(new)
  for pid in selected:
   try:
    tasks=list((pathlib.Path('/proc')/str(pid)/'task').iterdir());before=sorted(os.sched_getaffinity(pid))
    for tid in tasks:os.sched_setaffinity(int(tid.name),host)
    result['ownedTestProcesses'].setdefault(str(pid),{'beforeCpus':before,'afterCpus':sorted(host)})
   except (OSError,ProcessLookupError):pass
 if (r/'raw'/str(receipt+'.json')).exists():
  result['status']='APPLIED' if len(result['ownedContainers'])==2 and result['ownedTestProcesses'] else 'NOT_APPLIED';result['commandStatus']=json.loads((r/'raw'/str(receipt+'.json')).read_text())['status'];break
 time.sleep(1)
else:result['status']='TIMED_OUT'
result['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(r/(report+'.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));assert result['status']=='APPLIED'
