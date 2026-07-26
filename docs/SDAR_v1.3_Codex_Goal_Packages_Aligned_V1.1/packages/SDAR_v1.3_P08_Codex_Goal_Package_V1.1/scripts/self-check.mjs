import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const lock=JSON.parse(fs.readFileSync(path.join(root,'CONTRACT-LOCK.json'),'utf8'));
if(manifest.packageId!=='SDAR-V1.3-P08') throw new Error('packageId');
if(manifest.sequence!==8||manifest.totalFormalPackages!==14||manifest.formalPackage!==true) throw new Error('sequence');
if(manifest.contractRegistrySha256!=='d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb'||lock.registrySha256!=='d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb') throw new Error('registry hash');
if(manifest.atomicGoals.join(',')!=='G15') throw new Error('goals');
const handoff=JSON.parse(fs.readFileSync(path.join(root,'templates/STANDARD-HANDOFF.json'),'utf8'));
const required=["schemaVersion", "packageId", "packageVersion", "sequence", "status", "repository", "baselineSha", "branch", "commits", "draftPrUrl", "contractRegistryVersion", "contractRegistrySha256", "consumedContracts", "producedContracts", "migrations", "repositoryPorts", "applicationPorts", "runtimePorts", "events", "queues", "featureFlags", "reasonCodeCatalogVersion", "evidenceRefs", "acceptanceSummary", "knownLimitations", "openBlockers", "nextPackage", "packageOutputs"];
for(const field of required) if(!(field in handoff)) throw new Error(`handoff field ${field}`);
const sums=JSON.parse(fs.readFileSync(path.join(root,'SHA256SUMS.json'),'utf8'));
for(const [rel,expected] of Object.entries(sums.files)){const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,rel))).digest('hex');if(actual!==expected)throw new Error(`hash ${rel}`);}
const docs=fs.readdirSync(root).filter(f=>f.endsWith('.md')).map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
for(const bad of ["RuntimeCandidateDecision", "PlanTemplateRuntime", "DecisionRuleRuntime", "RuleEvaluationContext", "artifact.approval_created", "artifact.revalidated"]) if(docs.includes(bad)) throw new Error(`forbidden alias ${bad}`);
console.log(JSON.stringify({ok:true,packageId:manifest.packageId,goals:manifest.atomicGoals,registry:lock.registrySha256,filesChecked:Object.keys(sums.files).length},null,2));
