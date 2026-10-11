#!/usr/bin/env python3
"""Validate this document task pack only; never execute product or network actions."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote


def validate(root: Path, skip_checksums: bool = False) -> dict:
    root = root.resolve()
    errors: list[str] = []
    json_docs: dict[str, object] = {}
    for path in sorted(root.rglob('*.json')):
        try:
            json_docs[path.relative_to(root).as_posix()] = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            errors.append(f'Invalid JSON {path.relative_to(root)}: {exc}')
    case_doc = json_docs.get('acceptance/CASES.json', {})
    cases = case_doc.get('cases', []) if isinstance(case_doc, dict) else []
    ids = [c.get('id') for c in cases if isinstance(c, dict)]
    if len(ids) != len(set(ids)):
        errors.append('Duplicate acceptance case IDs')
    if set(ids) != {f'AC-{i:03d}' for i in range(1, 51)}:
        errors.append('Expected exact AC-001 through AC-050 specification')
    if isinstance(case_doc, dict) and case_doc.get('caseCount') != len(cases):
        errors.append('caseCount does not match case records')
    for c in cases:
        if not isinstance(c, dict):
            errors.append('Case must be an object'); continue
        for field in ['id', 'workItem', 'title', 'layer', 'given', 'when', 'then', 'forbidden', 'evidenceRequired']:
            if not c.get(field): errors.append(f"{c.get('id')}: missing {field}")
        if c.get('workItem') not in {f'W{i}' for i in range(6)}:
            errors.append(f"{c.get('id')}: unknown work item")
        if c.get('status') != 'NOT_RUN':
            errors.append(f"{c.get('id')}: specification must not claim product verification")
    trace = json_docs.get('acceptance/TRACEABILITY.json', {})
    requirements = trace.get('requirements', []) if isinstance(trace, dict) else []
    covered: set[str] = set()
    for req in requirements:
        refs = set(req.get('caseIds', [])); covered.update(refs)
        if not refs <= set(ids): errors.append(f"{req.get('id')}: unknown case reference")
    if covered != set(ids): errors.append('Every acceptance case must have requirement coverage')
    lock = json_docs.get('BASELINE.lock.json', {})
    try:
        pins = [lock['sdar']['observedMainSha'], lock['sdar']['integrationHeadSha'], lock['smpp']['compatibilitySha']]
        if not all(re.fullmatch(r'[0-9a-f]{40}', p) for p in pins):
            errors.append('Baseline must use full 40-character commit pins')
        if lock['authorization']['thisDelivery'] != 'documents_only':
            errors.append('Delivery authorization boundary is incorrect')
    except (KeyError, TypeError):
        errors.append('Incomplete baseline lock')
    for path in sorted(root.rglob('*.md')):
        text = path.read_text(encoding='utf-8')
        for target in re.findall(r'\[[^\]\n]*\]\(([^)\n]+)\)', text):
            target = target.strip().split(' "', 1)[0]
            if not target or target.startswith('#') or re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target):
                continue
            relative = unquote(target.split('#', 1)[0])
            resolved = (path.parent / relative).resolve()
            try: resolved.relative_to(root)
            except ValueError:
                errors.append(f'Link outside task pack in {path.relative_to(root)}: {target}'); continue
            if not resolved.exists():
                errors.append(f'Broken link in {path.relative_to(root)}: {target}')
    manifest_path = root/'MANIFEST.json'
    if not skip_checksums:
        manifest = json_docs.get('MANIFEST.json')
        if not isinstance(manifest, dict): errors.append('Missing or invalid MANIFEST.json')
        else:
            listed = manifest.get('files', {})
            actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p != manifest_path and '__pycache__' not in p.parts}
            if not isinstance(listed, dict): errors.append('Invalid manifest file map')
            else:
                if set(listed) != actual: errors.append('Manifest inventory mismatch')
                for name, digest in listed.items():
                    p = (root/name).resolve()
                    try: p.relative_to(root)
                    except ValueError:
                        errors.append(f'Unsafe manifest path: {name}'); continue
                    if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != digest:
                        errors.append(f'Hash mismatch: {name}')
    return {'ok':not errors, 'scope':'taskpack_static_only', 'caseCount':len(cases),
            'requirementCount':len(requirements), 'markdownFiles':len(list(root.rglob('*.md'))), 'errors':errors}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--skip-checksums', action='store_true', help='Structure checks only; for packaging, not final integrity verification')
    args = parser.parse_args()
    result = validate(args.root, args.skip_checksums)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
