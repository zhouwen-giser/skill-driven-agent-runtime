#!/usr/bin/env python3
"""Offline, read-only source audit. Prints JSON; never switches branches or reads secrets."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

KNOWN_PATHS = [
    'AGENTS.md', 'PLANS.md', 'package.json',
    'docs/SDAR_SMPP_UGV_V13_ADAPTER.md',
    'packages/mcp-adapter/src/smpp-task-business-client.ts',
    'packages/application/src/mcp-registry.ts',
    'packages/application/src/business-events.ts',
    'packages/application/src/remote-task-input.ts',
    'packages/persistence-postgres/src/index.ts',
    'apps/server/src/runtime.ts',
]


def git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(['git', '--no-optional-locks', '-C', str(repo), *args], text=True, capture_output=True, timeout=15, check=False)


def audit(repo: Path, baseline: Path) -> dict:
    repo = repo.resolve()
    check = git(repo, 'rev-parse', '--show-toplevel')
    if check.returncode != 0:
        raise ValueError('The supplied path is not an accessible Git worktree')
    root = Path(check.stdout.strip()).resolve()
    lock = json.loads(baseline.read_text(encoding='utf-8'))
    head = git(root, 'rev-parse', 'HEAD')
    branch = git(root, 'branch', '--show-current')
    status = git(root, 'status', '--porcelain', '--untracked-files=normal')
    pins = {}
    for label, pin in [('observedMain', lock['sdar']['observedMainSha']),
                       ('pr34Head', lock['sdar']['integrationHeadSha'])]:
        exists = git(root, 'cat-file', '-e', pin+'^{commit}')
        if exists.returncode != 0:
            pins[label] = {'sha':pin, 'locallyAvailable':False, 'ancestorOfHead':None}
        else:
            ancestor = git(root, 'merge-base', '--is-ancestor', pin, 'HEAD')
            pins[label] = {'sha':pin, 'locallyAvailable':True, 'ancestorOfHead':ancestor.returncode==0 if ancestor.returncode in (0,1) else None}
    paths = {}
    for name in KNOWN_PATHS:
        path = root/name
        paths[name] = {'exists':path.is_file(), 'sha256':hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None}
    package = {}
    if (root/'package.json').is_file():
        package = json.loads((root/'package.json').read_text(encoding='utf-8'))
    return {'scope':'offline_source_audit_only', 'repositoryRoot':str(root),
            'head':head.stdout.strip() if head.returncode==0 else None,
            'branch':branch.stdout.strip() or '(detached)',
            'workingTreeStatus':status.stdout.splitlines(), 'baselinePins':pins,
            'knownPaths':paths, 'packageManager':package.get('packageManager'),
            'nodeEngines':package.get('engines',{}).get('node'),
            'availableScriptNames':sorted(package.get('scripts',{})),
            'networkRequests':0, 'repositoryWrites':0, 'siteProbes':0,
            'note':'Missing pins/symbols require inspection; this does not verify implementation, CI or deployment.'}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, default=Path(__file__).resolve().parents[1]/'BASELINE.lock.json')
    args = parser.parse_args()
    try:
        result = audit(args.repo, args.baseline)
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({'ok':False, 'scope':'offline_source_audit_only', 'error':str(exc)},ensure_ascii=False))
        return 2
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
