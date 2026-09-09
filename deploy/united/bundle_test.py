import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
import shutil
import os

spec = importlib.util.spec_from_file_location('bundle', Path(__file__).with_name('bundle.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def union(files):
    files = dict(files)
    files['SHA256SUMS'] = ''.join(f'{b.digest(v)}  {k}\n' for k, v in sorted(files.items())).encode()
    return b.archive({'fixture/'+k: v for k, v in files.items()})


def upstream():
    source = b.archive({'README.md': b'source'})
    desc = {'sha256': b.digest(source)}
    inner = union({'UNION.json': b.encode({'smpp': {**desc, 'revision': 'fixture'}, 'base': desc, 'gowm': desc, 'baseSourceSha256': 'base'}),
                   **{'upstream/'+n+'.tar.gz': source for n in ['analysis', 'gowm', 'smpp']}})
    schema = b.encode({'version': 1, 'objects': [{'name': name, 'kind': 'TABLE'} for name in ['sdar_core.external_provider_fact', 'sdar_core.external_entity_relation_fact']]})
    seed = b'{"release_version":"fixture"}\n'
    manifest = {'schemaVersion': 1, 'executionMode': 'live', 'telemetry': desc,
                'upstream': {'sha256': b.digest(inner), 'root': 'fixture', 'smppRevision': 'fixture', 'baseSourceSha256': 'base'},
                'sdarSchema': {'sha256': b.digest(schema), 'objects': 2, 'releaseSeed': {'sha256': b.digest(seed)}}}
    return union({'UNION.json': b.encode(manifest), 'upstream/smpp-united.tar.gz': inner,
                  'upstream/telemetry.tar.gz': source, 'sdar/schema.json': schema, 'sdar/schema-contract-release.jsonl': seed})


class BundleTests(unittest.TestCase):
    def test_valid_nested_and_missing_or_changed_member(self):
        data = upstream()
        self.assertEqual(b.validate_upstream(data)[0], 'fixture')
        _, files = b.rooted(data)
        del files['upstream/smpp-united.tar.gz']
        with self.assertRaisesRegex(ValueError, 'INVENTORY'):
            b.validate_upstream(b.archive({'fixture/'+k: v for k, v in files.items()}))
        _, files = b.rooted(data)
        files['sdar/schema.json'] = b'{}'
        with self.assertRaisesRegex(ValueError, 'UPSTREAM_IDENTITY'):
            b.validate_upstream(union({k:v for k,v in files.items() if k != 'SHA256SUMS'}))

    def test_unsafe_paths_types_and_duplicates(self):
        for name in ['../escape', '/absolute', 'a/../b', 'a\\b']:
            with self.assertRaisesRegex(ValueError, 'UNSAFE_ARCHIVE'):
                b.members(b.archive({name: b'bad'}))
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE]:
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode='w:gz') as archive:
                item = tarfile.TarInfo('link'); item.type = kind; item.linkname = '/tmp/escape'; archive.addfile(item)
            with self.assertRaisesRegex(ValueError, 'UNSAFE_ARCHIVE_TYPE'):
                b.members(out.getvalue())
        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode='w:gz') as archive:
            for _ in range(2):
                archive.addfile(tarfile.TarInfo('same'), io.BytesIO(b''))
        with self.assertRaisesRegex(ValueError, 'UNSAFE_ARCHIVE_PATH'):
            b.members(out.getvalue())

    def test_source_coverage_and_identity(self):
        entries = [{'path': 'source.txt', 'sha256': b.digest(b'source')}]
        h = b.digest(json.dumps(entries, separators=(',', ':')).encode())
        files = {'source.txt': b'source', 'sdar-deployment-source.json': b.encode({'sourceRevision': 'rev', 'sourceHash': h})}
        blob = b.archive(files)
        manifest = {'files': entries, 'sourceRevision': 'rev', 'sourceHash': h, 'archiveSha256': b.digest(blob)}
        b.validate_source(blob, manifest)
        del files['source.txt']
        with self.assertRaisesRegex(ValueError, 'SOURCE_COVERAGE'):
            b.validate_source(b.archive(files), manifest)

    def test_cli_reproducibility_secrets_checksum_and_conflict(self):
        repo = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in ['deploy/united', 'deploy/development']:
                shutil.copytree(repo/relative, root/relative, ignore=shutil.ignore_patterns('__pycache__'))
            (root/'package.json').write_text('{"type":"module"}')
            (root/'uncommitted.txt').write_text('included')
            (root/'.env').write_text('SECRET=never-package-this')
            (root/'business-connections.env').write_text('SECRET=never-package-this')
            (root/'secrets').mkdir(); (root/'secrets/password.txt').write_text('never-package-this')
            (root/'out').mkdir(); (root/'out/prior-delivery.json').write_text('must-not-be-source')
            (root/'bin').mkdir()
            fake = root/'bin/git'
            fake.write_text('#!/usr/bin/env python3\nimport sys\nprint("a"*40) if sys.argv[1]=="rev-parse" else sys.stdout.write("package.json\\0out/prior-delivery.json\\0deleted.txt\\0uncommitted.txt\\0.env\\0business-connections.env\\0secrets/password.txt\\0")\n')
            fake.chmod(0o755)
            env = {**os.environ, 'PATH': str(root/'bin')+':'+os.environ['PATH']}
            path = root/'input.tar.gz'; path.write_bytes(upstream())
            sidecar = Path(str(path)+'.sha256')
            sidecar.write_text(f'{b.digest(path.read_bytes())}  {path.name}\n')
            cmd = ['node', str(root/'deploy/united/package.mjs'), '--', '--upstream', str(path), '--output', str(root/'out')]
            def run():
                return subprocess.run(cmd, cwd=root, env=env, capture_output=True, text=True)
            first = run(); self.assertEqual(first.returncode, 0, first.stderr)
            record = json.loads(first.stdout)
            second = run(); self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(json.loads(second.stdout), record)
            _, files, _ = b.verify(Path(record['archive']).read_bytes())
            source = b.members(files['sdar/source.tar.gz'])
            self.assertEqual(source['uncommitted.txt'], b'included')
            self.assertNotIn('deleted.txt', source)
            self.assertNotIn('out/prior-delivery.json', source)
            self.assertNotIn('.env', source); self.assertNotIn('business-connections.env', source); self.assertNotIn('secrets/password.txt', source)
            sidecar.write_text('0'*64+'  '+path.name+'\n')
            wrong = run(); self.assertNotEqual(wrong.returncode, 0); self.assertIn('UPSTREAM_HASH_MISMATCH', wrong.stderr)
            sidecar.write_text(f'{b.digest(path.read_bytes())}  {path.name}\n')
            Path(record['archive']).write_bytes(b'conflict')
            conflict = run(); self.assertNotEqual(conflict.returncode, 0); self.assertIn('OUTPUT_CONFLICT', conflict.stderr)
            self.assertEqual(Path(record['archive']).read_bytes(), b'conflict')
            self.assertFalse(list((root/'out').glob('.sdar-union-*')))
            (root/'uncommitted.txt').write_text('-----BEGIN ' + 'PRIVATE KEY-----\nfixture')
            private = run(); self.assertNotEqual(private.returncode, 0); self.assertIn('PACKAGE_PRIVATE_KEY_REFUSED', private.stderr)


if __name__ == '__main__':
    unittest.main()
