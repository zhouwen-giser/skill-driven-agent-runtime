#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
base = (ROOT / 'docs/01_REQUIREMENTS_BASELINE.md').read_text(encoding='utf-8')
trace = (ROOT / 'docs/17_TRACEABILITY_MATRIX.md').read_text(encoding='utf-8')
ids = sorted(set(re.findall(r'\b(?:FR|NFR)-[A-Z]+-\d{3}\b', base)))
missing = [item for item in ids if item not in trace]
if missing:
    print('missing traceability ids:', *missing, sep='\n- ')
    sys.exit(1)
print(f'traceability contains {len(ids)} requirement ids')
