import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const registry=JSON.parse(fs.readFileSync(path.join(root,'shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json'),'utf8'));
const expected=["P00", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12", "P13"];
const report={ok:true,packages:[],errors:[]};
const produced=new Map();
for(const pkg of expected){
 const dirs=fs.readdirSync(path.join(root,'packages')).filter(x=>x.includes(`_${pkg}_`));
 if(dirs.length!==1){report.errors.push(`${pkg} directory count`);continue;}
 const d=path.join(root,'packages',dirs[0]);
 const m=JSON.parse(fs.readFileSync(path.join(d,'manifest.json'),'utf8'));
 const l=JSON.parse(fs.readFileSync(path.join(d,'CONTRACT-LOCK.json'),'utf8'));
 if(m.contractRegistrySha256!==registry.registrySha256||l.registrySha256!==registry.registrySha256) report.errors.push(`${pkg} registry hash`);
 if(m.sequence!==Number(pkg.slice(1))||m.formalPackage!==true||m.totalFormalPackages!==14) report.errors.push(`${pkg} sequence`);
 for(const n of m.consumesContracts){if(!(n in registry.contracts)) report.errors.push(`${pkg} unknown consume ${n}`); const owner=registry.contracts[n]?.owner; if(owner!=='shared'&&owner!=='P00'&&!produced.has(n)) report.errors.push(`${pkg} consumes before produced ${n}`);}
 for(const n of m.producesContracts){if(!(n in registry.contracts)) report.errors.push(`${pkg} unknown produce ${n}`); if(produced.has(n)) report.errors.push(`${pkg} duplicate owner ${n}`); produced.set(n,pkg);}
 const run=spawnSync('node',[path.join(d,'scripts/self-check.mjs')],{cwd:d,encoding:'utf8'});
 if(run.status!==0) report.errors.push(`${pkg} selfcheck: ${run.stderr||run.stdout}`);
 report.packages.push({package:pkg,goals:m.atomicGoals,consumes:m.consumesContracts,produces:m.producesContracts,selfCheck:run.status===0});
}
const goals=report.packages.flatMap(p=>p.goals);
const expectedGoals=['G00','G01','G02','G03','G04','G05','G06','G07','G08','G09','G10','G11','G12','G13','G14','G15','G16','G17','G18','G19','G20','G21','G22'];
if(JSON.stringify(goals)!==JSON.stringify(expectedGoals)) report.errors.push(`goal coverage ${JSON.stringify(goals)}`);
report.ok=report.errors.length===0;
fs.writeFileSync(path.join(root,'audit/cross-package-validation.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
process.exit(report.ok?0:1);
