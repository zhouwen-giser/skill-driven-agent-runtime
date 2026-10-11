"""Package-tool tests only, not SDAR product tests."""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]


def load(name, path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


CHECK=load('taskpack_check',ROOT/'scripts/check_taskpack.py')
AUDIT=load('taskpack_audit',ROOT/'scripts/audit_repo.py')


class PackageToolsTests(unittest.TestCase):
    def copy_pack(self, dest):
        shutil.copytree(ROOT,dest,ignore=shutil.ignore_patterns('__pycache__'))

    def test_structure_and_coverage(self):
        self.assertTrue(CHECK.validate(ROOT,True)['ok'])

    def test_duplicate_case_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'pack';self.copy_pack(p)
            f=p/'acceptance/CASES.json';d=json.loads(f.read_text());d['cases'][1]['id']=d['cases'][0]['id'];f.write_text(json.dumps(d))
            self.assertFalse(CHECK.validate(p,True)['ok'])

    def test_broken_link_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'pack';self.copy_pack(p)
            with (p/'README.md').open('a') as f:f.write('\n[invalid](missing-file.md)\n')
            self.assertFalse(CHECK.validate(p,True)['ok'])

    def test_invalid_json_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'pack';self.copy_pack(p)
            (p/'BASELINE.lock.json').write_text('{')
            self.assertFalse(CHECK.validate(p,True)['ok'])

    def test_non_repository_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):AUDIT.audit(Path(tmp),ROOT/'BASELINE.lock.json')

    def test_audit_is_read_only_and_missing_pins_visible(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo=Path(tmp)
            subprocess.run(['git','init','-q',str(repo)],check=True,capture_output=True)
            package={'name':'fixture-only','packageManager':'pnpm@11.7.0','scripts':{'typecheck':'fixture-only'}}
            (repo/'package.json').write_text(json.dumps(package))
            subprocess.run(['git','-C',str(repo),'add','package.json'],check=True,capture_output=True)
            subprocess.run(['git','-C',str(repo),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-q','-m','fixture'],check=True,capture_output=True)
            before=subprocess.run(['git','-C',str(repo),'status','--porcelain'],capture_output=True,text=True,check=True).stdout
            report=AUDIT.audit(repo,ROOT/'BASELINE.lock.json')
            after=subprocess.run(['git','-C',str(repo),'status','--porcelain'],capture_output=True,text=True,check=True).stdout
            self.assertEqual(before,after)
            self.assertEqual(report['repositoryWrites'],0)
            self.assertEqual(report['networkRequests'],0)
            self.assertFalse(report['baselinePins']['pr34Head']['locallyAvailable'])
            self.assertEqual(report['packageManager'],'pnpm@11.7.0')

    def test_manifest_tamper_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'pack';self.copy_pack(p)
            with (p/'README.md').open('a') as f:f.write('\nchanged\n')
            self.assertFalse(CHECK.validate(p,False)['ok'])


if __name__=='__main__':
    unittest.main()
