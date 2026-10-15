import pathlib,json,hashlib,datetime,re,subprocess
sdar=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1');smpp=pathlib.Path('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform');r=sdar/'reports/inspection-area-v1';now=datetime.datetime.now(datetime.timezone.utc).isoformat();read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert read(r/'raw/sdar-inspection-gate-18.json')['status']=='PASS'
cpu=read(r/'PERFORMANCE_CPU_GATE18.json');assert cpu['status']=='APPLIED' and cpu['commandStatus']=='PASS'

assert read(smpp/'reports/inspection-area-v1/raw/smpp-inspection-gate-11.json')['status']=='PASS'
for name in ['GOVERNANCE_AFTER','PRESERVATION','CONTAINER_SOURCE','BINDING_UPGRADE']:assert read(r/(name+'.json'))['status']=='PASS',name
bootstrap=read(r/'BOOTSTRAP.json');assert bootstrap['status'] in ['registered','succeeded','passed'] and not bootstrap.get('blocked') and bootstrap.get('deviceCalls')==0
assert read(r/'CATALOG_AFTER.json')['count']==13
lock=read(r/'RUNTIME_SOURCE_LOCK.json')
for e in lock['files']:
 delta=next((x for x in lock.get('postGateDocumentation',{}).get('files',[]) if x['path']==e['path']),None)
 if delta:assert e['path']=='deploy/united/README.md' and delta['beforeSha256']==e['sha256']
 assert sha(sdar/e['path'])==(delta['afterSha256'] if delta else e['sha256']),e['path']
for repo in [smpp,sdar]:
 b=repo/'reports/inspection-area-v1/BASELINE.json';base=read(b);changed=[e['file'] for e in base['frozenAssets'] if sha(repo/e['file'])!=e['sha256']];assert not changed,changed;(b.parent/'FROZEN_FINAL.json').write_text(json.dumps({'status':'PASS','checkedAt':now,'assets':len(base['frozenAssets']),'baselineSha256':sha(b),'changed':[]},indent=2)+'\n')
deployment=read(r/'DEPLOYMENT.json');old=r/'DEPLOYMENT_SERVICES_UPDATED.json'
if not old.exists():old.write_bytes((r/'DEPLOYMENT.json').read_bytes())
deployment.update(status='LOCAL_DEPLOYED_READONLY_ACCEPTED',acceptedAt=now,bootstrapEvidence='BOOTSTRAP.json',governanceEvidence='GOVERNANCE_AFTER.json',preservationEvidence='PRESERVATION.json',physicalExecution='NOT_RUN');(r/'DEPLOYMENT.json').write_text(json.dumps(deployment,indent=2)+'\n')
keys=['name','status','exitCode','sourceBefore','sourceAfter','logSha256'];receipt=lambda p:{k:read(p)[k] for k in keys}
d=read(r/'VALIDATION.json');d.update(status='LOCAL_DEPLOYED_READONLY_ACCEPTED',recordedAt=now,smppFullGate=receipt(smpp/'reports/inspection-area-v1/raw/smpp-inspection-gate-11.json'),sdarFullGate=receipt(r/'raw/sdar-inspection-gate-18.json'),formalJoint=receipt(r/'raw/sdar-inspection-joint-68.json'),nativeCatalogToolCount=13,siteSkillInventory=14,physicalExecution='NOT_RUN',siteAcceptance='native publication and readonly composability; no physical patrol submitted',sdarRuntimeInputSha256=lock['gateInputSha256'],smppPostGateChanges=read(smpp/'reports/inspection-area-v1/RUNTIME_SOURCE_LOCK.json')['postGateChanges'],delivery=read(r/'DURABLE_DELIVERY.json'))
d['postGateDocumentation']=lock.get('postGateDocumentation',{})
d['performanceMetrics']=next(json.loads(line) for line in (r/'raw/sdar-inspection-gate-18.log').read_text().splitlines() if line.startswith('{\"event\":\"phase13.performance.raw_metrics\"'));d['performanceMetrics']={k:d['performanceMetrics'][k] for k in ['baselineP95RawMs','evidenceEnabledP95RawMs','regressionRawPercent','baselineMedianDriftRawPercent','appendP95RawMs']}
d['verificationEnvironment']={'mainPostgresStorage':'owned disposable tmpfs 2GiB with real WAL; separate persistent-volume integration and migration evidence retained','performanceCpuAffinity':{'node':1,'hostCpus':cpu['hostCpus'],'databaseCpus':cpu['databaseCpus'],'evidence':'PERFORMANCE_CPU_GATE18.json'},'officialTckPinnedCache':'PINNED_TCK_CACHE_GATE18.json','testsOrThresholdsChanged':False,'productionSloOrDurabilityQualified':False}
d['postgresBindingRegression']={'receipt':receipt(r/'raw/sdar-inspection-cas-persistence-green-02.json'),'scope':'Real PostgreSQL: retained immediate Catalog lineage, exact old versions, idempotent replay, counter-only rejection under binding/source locks; three tests passed.'}
d['formalJointTraceDerivation']={'path':'JOINT_CLEANUP_TRACE_DERIVATION.json','sha256':sha(r/'JOINT_CLEANUP_TRACE_DERIVATION.json')}
d['retainedFailures']=['GATE14_NETWORK_FAILURE.json','JOINT_66_SHUTDOWN.json','raw/sdar-inspection-gate-12.json','raw/sdar-inspection-gate-13.json','raw/sdar-inspection-gate-15.json','raw/sdar-inspection-perf-cpu-01.json','raw/sdar-inspection-gate-17.json','raw/sdar-inspection-binding-upgrade-01.json','raw/sdar-inspection-binding-upgrade-02.json','raw/sdar-inspection-binding-upgrade-03.json','raw/sdar-inspection-live-bootstrap-02.json','raw/sdar-inspection-cas-persistence-red-02.json','raw/sdar-inspection-cas-persistence-green-01.json']
for e in d['requirements']:
 if e['id']=='INSPECT-06':e['status']='PASS';e['evidence']=['FULL_GATE.json','JOINT.json','CATALOG_AFTER.json','BOOTSTRAP.json','BINDING_UPGRADE.json','GOVERNANCE_AFTER.json','PRESERVATION.json','CONTAINER_SOURCE.json','DURABLE_DELIVERY.json']
d['nativeEvidence']={n:sha(r/(n+'.json')) for n in ['BOOTSTRAP','BINDING_UPGRADE','GOVERNANCE_AFTER','PRESERVATION','CONTAINER_SOURCE','CATALOG_AFTER']};(r/'VALIDATION.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
for repo in [smpp,sdar]:
 out=repo/'reports/inspection-area-v1';(out/'FINAL_VALIDATION.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
paths={sdar:['PROJECT_STATUS.md','CHANGELOG.md','docs/17_TRACEABILITY_MATRIX.md','execplans/EP-INSPECTION-AREA-V1.md'],smpp:['docs/execplans/inspection-area-v1.md']};before={(str(repo),f):sha(repo/f) for repo,fs in paths.items() for f in fs}
for repo,f in [(sdar,'execplans/EP-INSPECTION-AREA-V1.md'),(smpp,'docs/execplans/inspection-area-v1.md')]:
 p=repo/f;s=p.read_text();s=s.replace('- [ ] 完整门禁、固定源码交付、本地只读发布与回退验证。','- [x] 完整门禁、固定源码交付、本地原生发布及只读验收；回退步骤和私有配置已保留，实际生产回退演练 NOT_RUN。');s+='\n## 交付验收封存（2026-10-15）\n\nSMPP gate-11 完整门禁及最终远端 Runtime CI 通过；8 项后续 CI/夹具/配置清单调整均记录独立回执，生产模块及冻结迁移未变。SDAR 最终 gate-18 通过全部 30 阶段和清理，joint-68 的四个检查与四个巡逻场景通过。原生同一 Provider CAS 目录升级保留绑定身份及旧版本，正式 bootstrap 发布检查与巡逻后继版本，19100 返回精确 13 工具。五个目标容器、三份 SDAR 源码、镜像身份及 48 个上游实例的保留核验通过；数据库卷、签名密钥及 PMS 配置保留。联合包、命令、退出码、源码和日志哈希见 reports/inspection-area-v1/FINAL_VALIDATION.json。现场巡逻与实际生产回退演练为 NOT_RUN；不声明全项目或生产耐久性验收。\n';p.write_text(s)
p=sdar/'PROJECT_STATUS.md';s=p.read_text();s=re.sub(r'(?m)^2026-10-15：[^\n]*\n\n', '', s, count=1);start=s.index('## 区域检查与巡逻接入');end=s.index('## Local SMPP integrated deployment',start);s=s[:start]+'''## 区域检查与巡逻接入（2026-10-15，LOCAL_DEPLOYED_READONLY_ACCEPTED）

SMPP vehicle_inspect_area、SDAR embodied.inspect_area 及巡逻后继版本已完成本次实现和本地只读交付。SMPP 完整门禁、最终 SDAR 30 阶段与清理、八场景真实 PostgreSQL/MQTT/Device MCP 隔离链均通过。19100 提供精确 13 工具；原生同 Provider CAS 目录升级保留绑定身份和旧版本，检查、巡逻及全部 14 项站点清单通过治理发布和只读组合验收。五个目标容器已更新，卷、签名密钥、PMS、绑定及 48 个上游实例保留。失败回执继续保存。交付、源码、镜像和证据哈希见 reports/inspection-area-v1/FINAL_VALIDATION.json；现场巡逻、生产回退演练及全项目生产验收仍为 NOT_RUN/OPEN。下述旧部署记录为历史。

'''+s[end:];p.write_text(s)
p=sdar/'CHANGELOG.md';s=p.read_text();needle='## 2026-10-14 — 区域检查与巡逻组合\n';s=s.replace(needle,needle+'\n- 本地 19100 和 SDAR 五个目标容器已更新；精确 13 工具、14 项正式清单、绑定历史与上游保留检查通过。最终 SDAR 30 阶段和八场景联合验收通过；现场执行 NOT_RUN，见 FINAL_VALIDATION.json。\n',1);p.write_text(s)
p=sdar/'docs/17_TRACEABILITY_MATRIX.md';s=p.read_text();s+='\nINSPECT-01–06 本次交付验收：SMPP gate-11、最终 SDAR gate-18 全 30 阶段及清理、joint-68 四项检查及四项巡逻均 PASS。原生 CAS 目录升级、13 工具、14 项发布/组合清单、五容器和三份源码对比以及原卷、密钥、PMS、绑定历史和 48 个上游实例保留均 PASS。对应证据为 reports/inspection-area-v1/FINAL_VALIDATION.json 与其逐项证据索引；现场设备巡逻及实际生产回退演练 NOT_RUN。此段只记录授权扩展的结果，不改需求正文或冻结合同。\n';p.write_text(s)
for repo,fs in paths.items():
 result={'status':'PASS','reason':'Post-gate acceptance status only; qualified runtime inputs are unchanged.','files':[{'path':f,'beforeSha256':before[(str(repo),f)],'afterSha256':sha(repo/f)} for f in fs]};(repo/'reports/inspection-area-v1/STATUS_CLOSEOUT_DELTA.json').write_text(json.dumps(result,indent=2)+'\n')
for e in lock['files']:
 delta=next((x for x in lock.get('postGateDocumentation',{}).get('files',[]) if x['path']==e['path']),None)
 if delta:assert e['path']=='deploy/united/README.md' and delta['beforeSha256']==e['sha256']
 assert sha(sdar/e['path'])==(delta['afterSha256'] if delta else e['sha256']),e['path']
print(json.dumps({'status':d['status'],'physicalExecution':'NOT_RUN','gateStages':30,'siteTools':13,'siteInventory':14}))
