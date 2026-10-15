import pathlib,json,re,hashlib,tarfile,io,datetime
from urllib.parse import urlsplit,unquote
sdar=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1');smpp=pathlib.Path('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform');r=sdar/'reports/inspection-area-v1';private=pathlib.Path('/tmp/smpp-inspection-v1-20261014/deployment');values=set()
def collect(value):
 if isinstance(value,dict):
  for key,v in value.items():
   if isinstance(v,str) and re.search(r'TOKEN|PASSWORD|SECRET|MASTER_KEY|ENCRYPTION_KEY|DATABASE_URL|REDIS_URL',key,re.I):
    if len(v)>=12 and not v.startswith(('/', 'file:', 'secret:')):values.add(v.encode())
    try:
     password=urlsplit(v).password
     if password and len(password)>=8:values.add(unquote(password).encode())
    except ValueError:pass
   elif isinstance(v,(dict,list)):collect(v)
 elif isinstance(value,list):
  for v in value:collect(v)
for p in [private/'sdar-environment.before.json',pathlib.Path('/mnt/data/sdar-local-integrated-20261013/config/.state/environment.json')]:collect(json.loads(p.read_text()))
baseline=json.loads((r/'DEPLOYMENT_BEFORE.json').read_text())
for e in baseline['files']:
 if e['name'].startswith('smpp-config/'):
  p=pathlib.Path('/home/sz/.smpp-debug/refresh-cfda8c7f-20261013-2i1s3dqr/smpp/deploy/development/server/config')/e['name'].split('/',1)[1];b=p.read_bytes()
  try:collect(json.loads(b))
  except (ValueError,UnicodeDecodeError):
   if 'key' in p.name.lower() and len(b.strip())>=16:values.add(b.strip())
findings=[];checked=0
def check(data,label):
 global checked
 checked+=1
 if any(v in data for v in values):findings.append(label)
def archive(data,label,depth=0):
 assert depth<=8
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as t:
  for m in t:
   if not m.isfile():continue
   b=t.extractfile(m).read();check(b,label+'!'+m.name)
   if m.name.endswith(('.tar.gz','.tgz')):archive(b,label+'!'+m.name,depth+1)
for repo,key in [(smpp,'smpp'),(sdar,'sdar')]:
 for p in (repo/'reports/inspection-area-v1').rglob('*'):
  if p.is_file():check(p.read_bytes(),key+'/'+str(p.relative_to(repo)))
for d in json.loads((r/'DURABLE_DELIVERY.json').read_text())['packages']:
 p=pathlib.Path(d['path']);b=p.read_bytes();assert hashlib.sha256(b).hexdigest()==d['sha256'];archive(b,p.name)
result={'status':'PASS' if not findings else 'FAIL','checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'liveSecretValuesCompared':len(values),'publicFilesAndArchiveMembersChecked':checked,'matchingPaths':findings,'secretValuesPrinted':False};(r/'PUBLIC_SECRET_CHECK.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));assert not findings
