from pathlib import Path
import json
import re
import sys
import yaml

root = Path(__file__).resolve().parents[1]
errors = []

# JSON schemas
schemas = {}
for p in sorted((root/'schemas').glob('*.json')):
    try:
        obj = json.loads(p.read_text(encoding='utf-8'))
        if obj.get('$schema') != 'https://json-schema.org/draft/2020-12/schema':
            errors.append(f'{p.name}: not draft 2020-12')
        schemas[p.stem.replace('.schema','')] = obj
    except Exception as exc:
        errors.append(f'{p.name}: {exc}')

# YAML parse and OpenAPI rules
operation_ids = set()
for name in ['node-control.openapi.yaml','runtime-control.openapi.yaml']:
    p=root/'openapi'/name
    try:
        spec=yaml.safe_load(p.read_text(encoding='utf-8'))
        if spec.get('openapi')!='3.1.0': errors.append(f'{name}: openapi != 3.1.0')
        for path,item in spec.get('paths',{}).items():
            for method,op in item.items():
                if method not in {'get','post','put','patch','delete'}: continue
                oid=op.get('operationId')
                if not oid: errors.append(f'{name}:{method}:{path}: missing operationId')
                elif oid in operation_ids: errors.append(f'duplicate operationId: {oid}')
                else: operation_ids.add(oid)
                if name=='node-control.openapi.yaml' and method in {'post','put','patch','delete'}:
                    names={x.get('name') for x in op.get('parameters',[]) if isinstance(x,dict)}
                    if 'Idempotency-Key' not in names:
                        errors.append(f'{oid}: external write missing Idempotency-Key')
    except Exception as exc:
        errors.append(f'{name}: {exc}')

# AsyncAPI
try:
    a=yaml.safe_load((root/'asyncapi/node-events.asyncapi.yaml').read_text(encoding='utf-8'))
    if a.get('asyncapi')!='2.6.0': errors.append('asyncapi version mismatch')
except Exception as exc: errors.append(f'asyncapi: {exc}')

# No telemetry queries or UI semantics in public API
public_text=(root/'openapi/node-control.openapi.yaml').read_text(encoding='utf-8').lower()
for forbidden in ['/telemetry/query','/timeline','/evaluations','/reconciliation','clickhouse','quality-issues']:
    if forbidden in public_text: errors.append(f'forbidden Node API concept: {forbidden}')
for forbidden in ['showgreenbadge','disablepublishbutton','pagelayout','buttontext','screenid']:
    if forbidden in public_text: errors.append(f'frontend semantic leaked: {forbidden}')

# Organization profile references valid operation IDs
profile=yaml.safe_load((root/'contracts/organization-facing-api-profile.yaml').read_text(encoding='utf-8'))
for oid in profile.get('allowedOperations',[])+profile.get('conditionalOperations',[]):
    if oid not in operation_ids: errors.append(f'organization profile references unknown operation: {oid}')

# Fixtures parse
for p in sorted((root/'fixtures').rglob('*.json')):
    try: json.loads(p.read_text(encoding='utf-8'))
    except Exception as exc: errors.append(f'{p}: {exc}')

if errors:
    print('\n'.join('ERROR: '+e for e in errors))
    sys.exit(1)
print('PASS')
print(f'json_schemas={len(list((root/"schemas").glob("*.json")))}')
print(f'operation_ids={len(operation_ids)}')
print(f'event_messages={len(a.get("components",{}).get("messages",{}))}')
print(f'fixtures={len(list((root/"fixtures").rglob("*.json")))}')
