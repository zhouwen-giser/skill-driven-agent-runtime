#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import hashlib
import json
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
errors = []

required = [
    "CODEX_MASTER_PROMPT.md",
    "00_MASTER_GOAL.md",
    "01_LATEST_MAIN_BASELINE_AND_BRANCH.md",
    "06_GIT_GITHUB_PHASE_DELIVERY_POLICY.md",
    "09_FINAL_PR_AND_MERGE_POLICY.md",
    "SOURCE_LOCK.json",
    "TASK.json",
    "schemas/goal-state.schema.json",
]
required += [f"phases/P{i:02d}.md" for i in range(15)]

for rel in required:
    if not (root / rel).is_file():
        errors.append(f"missing {rel}")

lock = json.loads((root / "SOURCE_LOCK.json").read_text(encoding="utf-8"))
for key, item in lock["frozenInputs"].items():
    p = root / "references" / item["filename"]
    if not p.exists():
        errors.append(f"missing frozen input {p.name}")
        continue
    digest = hashlib.sha256(p.read_bytes()).hexdigest()
    if digest != item["sha256"]:
        errors.append(f"hash mismatch {p.name}")
    try:
        with zipfile.ZipFile(p) as z:
            if z.testzip() is not None:
                errors.append(f"corrupt zip {p.name}")
    except Exception as exc:
        errors.append(f"invalid zip {p.name}: {exc}")

prompt = (root / "CODEX_MASTER_PROMPT.md").read_text(encoding="utf-8")
for phrase in [
    "git fetch --prune --tags origin",
    "feature/v1.4-node-control-backend",
    "每阶段",
    "Merge Commit",
    "不得绕过",
]:
    if phrase not in prompt:
        errors.append(f"master prompt missing: {phrase}")

# Safety prohibitions may mention unsafe commands as quoted examples.
# Only executable shell templates are checked for actually invoking them.
script_text = "\n".join(
    p.read_text(encoding="utf-8")
    for p in (root / "scripts").glob("*.sh")
)
for forbidden in ["git push --force", "git reset --hard origin/main"]:
    if forbidden in script_text:
        errors.append(f"unsafe executable instruction present: {forbidden}")

if errors:
    for e in errors:
        print(f"ERROR: {e}")
    sys.exit(1)

print("TASK_PACKAGE_OK")
print("phases=15")
print("frozen_inputs=2")
