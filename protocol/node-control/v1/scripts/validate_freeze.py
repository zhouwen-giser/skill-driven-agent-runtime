from pathlib import Path
import csv
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
operation_records = []
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
                else:
                    operation_ids.add(oid)
                    operation_records.append((name, oid, method.upper(), path))
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
for forbidden in ['/telemetry/query','/timeline','/evaluations','/reconciliation','clickhouse']:
    if forbidden in public_text: errors.append(f'forbidden Node API concept: {forbidden}')
for forbidden in ['showgreenbadge','disablepublishbutton','pagelayout','buttontext','screenid']:
    if forbidden in public_text: errors.append(f'frontend semantic leaked: {forbidden}')

# P11 exposes only bounded metadata and exact recovery commands.
p11_operations = {
    'listEvidenceOutbox': ('node-control.openapi.yaml','GET','/api/v1/evidence-export/outbox'),
    'listEvidenceSourceCheckpoints': ('node-control.openapi.yaml','GET','/api/v1/evidence-export/source-checkpoints'),
    'listEvidenceProjectionIssues': ('node-control.openapi.yaml','GET','/api/v1/evidence-export/projection-issues'),
    'listEvidenceQualityIssues': ('node-control.openapi.yaml','GET','/api/v1/evidence-export/quality-issues'),
    'getEpisodeEvidenceManifest': ('node-control.openapi.yaml','GET','/api/v1/evidence-export/episode-manifests/{episodeId}'),
    'listEvidenceDeadLetters': ('node-control.openapi.yaml','GET','/api/v1/evidence-export/dead-letters'),
    'replayEvidence': ('node-control.openapi.yaml','POST','/api/v1/evidence-export/replays'),
    'retryEvidenceDeadLetter': ('node-control.openapi.yaml','POST','/api/v1/evidence-export/dead-letters/{deadLetterId}/retry'),
    'reconcileEvidenceCoverage': ('node-control.openapi.yaml','POST','/api/v1/evidence-export/reconcile'),
    'getRuntimeEvidenceOperationsConfiguration': ('runtime-control.openapi.yaml','GET','/internal/v1/evidence-export/operations/configuration'),
    'getRuntimeEvidenceOperationsStatus': ('runtime-control.openapi.yaml','GET','/internal/v1/evidence-export/operations/status'),
    'listRuntimeEvidenceOutbox': ('runtime-control.openapi.yaml','GET','/internal/v1/evidence-export/operations/outbox'),
    'listRuntimeEvidenceSourceCheckpoints': ('runtime-control.openapi.yaml','GET','/internal/v1/evidence-export/operations/source-checkpoints'),
    'listRuntimeEvidenceProjectionIssues': ('runtime-control.openapi.yaml','GET','/internal/v1/evidence-export/operations/projection-issues'),
    'listRuntimeEvidenceQualityIssues': ('runtime-control.openapi.yaml','GET','/internal/v1/evidence-export/operations/quality-issues'),
    'getRuntimeEpisodeEvidenceManifest': ('runtime-control.openapi.yaml','GET','/internal/v1/evidence-export/operations/episode-manifests/{episodeId}'),
    'listRuntimeEvidenceDeadLetters': ('runtime-control.openapi.yaml','GET','/internal/v1/evidence-export/operations/dead-letters'),
    'replayRuntimeEvidence': ('runtime-control.openapi.yaml','POST','/internal/v1/evidence-export/operations/replays'),
    'retryRuntimeEvidenceDeadLetter': ('runtime-control.openapi.yaml','POST','/internal/v1/evidence-export/operations/dead-letters/{deadLetterId}/retry'),
    'reconcileRuntimeEvidenceCoverage': ('runtime-control.openapi.yaml','POST','/internal/v1/evidence-export/operations/reconcile'),
}
record_by_id = {oid: (name, method, path) for name, oid, method, path in operation_records}
for oid, expected in p11_operations.items():
    if record_by_id.get(oid) != expected:
        errors.append(f'P11 operation drift: {oid}')

try:
    with (root/'matrices/operation-inventory.csv').open(encoding='utf-8', newline='') as stream:
        inventory = list(csv.DictReader(stream))
    public_records = {
        oid: (method, path)
        for name, oid, method, path in operation_records
        if name == 'node-control.openapi.yaml'
    }
    inventory_records = {
        row['operationId']: (row['method'], row['path'])
        for row in inventory
    }
    if inventory_records != public_records:
        errors.append('public operation inventory does not exactly match Node Control OpenAPI')
except Exception as exc:
    errors.append(f'operation inventory: {exc}')

operations_schema = schemas.get('evidence-operations', {})
schema_text = json.dumps(operations_schema, sort_keys=True).lower()
for forbidden_property in ['"payload":', '"sql":', '"query":']:
    if forbidden_property in schema_text:
        errors.append(f'forbidden Evidence Operations field: {forbidden_property}')

try:
    with (root/'matrices/rbac-matrix.csv').open(encoding='utf-8', newline='') as stream:
        rbac = {row['role']: row for row in csv.DictReader(stream)}
    for role in ['node_admin','node_operator','node_viewer','security_admin']:
        if rbac.get(role, {}).get('evidence_export.read') != 'allow':
            errors.append(f'P11 Evidence metadata read role missing: {role}')
    for role in ['node_admin','security_admin']:
        if rbac.get(role, {}).get('evidence_export.recover') != 'allow':
            errors.append(f'P11 Evidence recovery role missing: {role}')
    organization = rbac.get('organization_service', {})
    if organization.get('evidence_export.read') or organization.get('evidence_export.recover'):
        errors.append('organization_service must not access Evidence Operations')
except Exception as exc:
    errors.append(f'rbac matrix: {exc}')

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
