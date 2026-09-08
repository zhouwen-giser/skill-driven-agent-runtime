#!/usr/bin/env python3
"""Verify this task package, not the SDAR implementation or upstream database."""
from __future__ import annotations
import hashlib
import json
import sys
from pathlib import Path


def verify(root: Path) -> dict:
    root = root.resolve()
    manifest = json.loads((root / 'PACKAGE_MANIFEST.json').read_text(encoding='utf-8'))
    declared: set[str] = set()
    for item in manifest['files']:
        rel = item['path']
        if rel in declared:
            raise ValueError(f'Duplicate manifest entry: {rel}')
        path = (root / rel).resolve()
        if root not in path.parents or path.is_symlink() or not path.is_file():
            raise ValueError(f'Invalid package path: {rel}')
        data = path.read_bytes()
        if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError(f'Content mismatch: {rel}')
        declared.add(rel)
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and '__pycache__' not in p.parts}
    if actual != declared | {'PACKAGE_MANIFEST.json', 'SHA256SUMS.txt'}:
        raise ValueError(f'Unexpected or missing files: {actual ^ (declared | {"PACKAGE_MANIFEST.json", "SHA256SUMS.txt"})}')
    sums = {}
    for line in (root / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
        digest, rel = line.split('  ', 1)
        if rel in sums:
            raise ValueError(f'Duplicate checksum: {rel}')
        if rel not in actual or rel == 'SHA256SUMS.txt':
            raise ValueError(f'Invalid checksum path: {rel}')
        if hashlib.sha256((root/rel).read_bytes()).hexdigest() != digest:
            raise ValueError(f'Checksum mismatch: {rel}')
        sums[rel] = digest
    if set(sums) != actual - {'SHA256SUMS.txt'}:
        raise ValueError('Incomplete checksum coverage')
    for p in root.rglob('*.json'):
        json.loads(p.read_text(encoding='utf-8'))
    task = json.loads((root/'task.json').read_text(encoding='utf-8'))
    acc = json.loads((root/'acceptance.json').read_text(encoding='utf-8'))['items']
    tests = json.loads((root/'test-scenarios.json').read_text(encoding='utf-8'))['scenarios']
    phase_ids = {p['id'] for p in task['phases']}
    test_ids = {t['id'] for t in tests}
    if len(test_ids) != len(tests) or len({a['id'] for a in acc}) != len(acc):
        raise ValueError('Duplicate acceptance/test ID')
    for a in acc:
        if a['phase'] not in phase_ids or not set(a['scenarioIds']) <= test_ids:
            raise ValueError(f'Invalid acceptance references: {a["id"]}')
        if a['status'] != 'NOT_RUN':
            raise ValueError('Task package must not claim project acceptance PASS')
    for t in tests:
        if t['phase'] not in phase_ids or t['executionStatus'] != 'NOT_RUN':
            raise ValueError(f'Invalid test design state: {t["id"]}')
    full = (root/'FULL_CN.md').read_text(encoding='utf-8')
    for key in ('SDAR_GOWM_SHARED_STORAGE_SOURCE_READY','SDAR_GOWM_SHARED_STORAGE_INTEGRATION_DEV_READY','SDAR_GOWM_SHARED_STORAGE_INCOMPLETE'):
        if key not in full:
            raise ValueError(f'Missing final marker: {key}')
    return {'packageStatus':'PASS','files':len(actual),'phases':len(phase_ids),'acceptanceItems':len(acc),
            'requiredScenarios':sum(t['tier']=='REQUIRED' for t in tests),
            'optionalScenarios':sum(t['tier']=='OPTIONAL_INTEROP' for t in tests),
            'projectTestsExecuted':False}

if __name__ == '__main__':
    try:
        root = Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parent.parent
        print(json.dumps(verify(root), ensure_ascii=False, indent=2))
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f'PACKAGE_VERIFY_FAILED: {e}', file=sys.stderr)
        sys.exit(1)
