BEGIN;

-- Development-only clean bootstrap. Existing incomplete bindings must be reset, not backfilled.
ALTER TABLE remote_task_binding
  ALTER COLUMN authority_snapshot_json SET NOT NULL,
  ADD COLUMN binding_authority_json jsonb NOT NULL,
  ADD COLUMN provider_identity_json jsonb,
  ADD COLUMN last_task_snapshot_json jsonb,
  ADD COLUMN last_task_projection text CHECK (last_task_projection IN ('create','detailed')),
  ADD COLUMN tenant_id text GENERATED ALWAYS AS (binding_authority_json->>'tenantId') STORED,
  ADD COLUMN project_id text GENERATED ALWAYS AS (binding_authority_json->>'projectId') STORED,
  ADD COLUMN environment text GENERATED ALWAYS AS (binding_authority_json->>'environment') STORED,
  ADD COLUMN episode_id text GENERATED ALWAYS AS (binding_authority_json->>'episodeId') STORED,
  ADD COLUMN sdar_task_id text GENERATED ALWAYS AS (agent_task_id) STORED,
  ADD COLUMN sdar_invocation_id text GENERATED ALWAYS AS (mcp_invocation_id) STORED,
  ADD COLUMN a2a_task_id text GENERATED ALWAYS AS (binding_authority_json->>'a2aTaskId') STORED,
  ADD COLUMN provider_origin_type text GENERATED ALWAYS AS (binding_authority_json->>'originType') STORED,
  ADD COLUMN provider_origin_source_id text GENERATED ALWAYS AS (binding_authority_json->>'providerSourceId') STORED,
  ADD COLUMN external_provider_id text GENERATED ALWAYS AS (binding_authority_json->>'externalProviderId') STORED,
  ADD COLUMN external_provider_instance_id text GENERATED ALWAYS AS (binding_authority_json->>'externalProviderInstanceId') STORED,
  ADD COLUMN external_server_id text GENERATED ALWAYS AS (binding_authority_json->>'externalServerId') STORED,
  ADD COLUMN registry_revision text GENERATED ALWAYS AS (binding_authority_json->>'registryRevision') STORED,
  ADD COLUMN registry_checksum text GENERATED ALWAYS AS (binding_authority_json->>'registryChecksum') STORED,
  ADD COLUMN binding_revision text GENERATED ALWAYS AS (version::text) STORED;

CREATE FUNCTION runtime_provider_binding_authority_valid(authority jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE field text;
BEGIN
  IF authority = '{"originType":"direct"}'::jsonb THEN RETURN true; END IF;
  IF authority->>'originType' IS DISTINCT FROM 'smpp_registry' THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['originType','tenantId','projectId','environment','episodeId','a2aTaskId',
    'providerSourceId','externalProviderId','externalProviderInstanceId','externalServerId','registryRevision','registryChecksum']
  LOOP
    IF jsonb_typeof(authority->field) IS DISTINCT FROM 'string' OR length(authority->>field)=0 THEN RETURN false; END IF;
  END LOOP;
  RETURN authority->>'registryRevision' ~ '^[1-9][0-9]*$'
    AND authority->>'registryChecksum' ~ '^[a-f0-9]{64}$'
    AND authority - ARRAY['originType','tenantId','projectId','environment','episodeId','a2aTaskId',
      'providerSourceId','externalProviderId','externalProviderInstanceId','externalServerId','registryRevision','registryChecksum'] = '{}'::jsonb;
END $$;

ALTER TABLE remote_task_binding ADD CONSTRAINT runtime_provider_binding_authority_check CHECK ((
  runtime_provider_binding_authority_valid(binding_authority_json)
  AND ((provider_origin_type='direct' AND (
    NOT (authority_snapshot_json ? 'providerBinding')
    OR authority_snapshot_json->'providerBinding'->>'originType'='direct'
  )) OR (
    provider_origin_type='smpp_registry'
    AND
    episode_id=agent_task_id AND a2a_task_id=agent_task_id
    AND jsonb_typeof(provider_identity_json)='object'
    AND provider_identity_json->>'profileVersion'='1.0'
    AND jsonb_typeof(provider_identity_json->'providerId')='string'
    AND jsonb_typeof(provider_identity_json->'providerInstanceId')='string'
    AND length(provider_identity_json->>'providerId') BETWEEN 1 AND 256
    AND length(provider_identity_json->>'providerInstanceId') BETWEEN 1 AND 256
    AND provider_identity_json - ARRAY['profileVersion','providerId','providerInstanceId']='{}'::jsonb
    AND external_provider_id=provider_identity_json->>'providerId'
    AND external_provider_instance_id=provider_identity_json->>'providerInstanceId'
    AND authority_snapshot_json->'providerBinding'->>'originType'='smpp_registry'
    AND provider_origin_source_id=authority_snapshot_json->'providerBinding'->>'smppSourceId'
    AND external_server_id=authority_snapshot_json->'providerBinding'->>'externalServerId'
    AND external_provider_id=authority_snapshot_json->'providerBinding'->>'providerId'
    AND external_provider_id=authority_snapshot_json->'providerBinding'->'registry'->>'externalProviderId'
    AND registry_revision=authority_snapshot_json->'providerBinding'->'registry'->>'revision'
    AND registry_checksum=authority_snapshot_json->'providerBinding'->'registry'->>'checksum'
    AND tenant_id=authority_snapshot_json->'providerBinding'->'scope'->>'tenantId'
    AND project_id=authority_snapshot_json->'providerBinding'->'scope'->>'projectId'
    AND environment=authority_snapshot_json->'providerBinding'->'scope'->>'environment'
    AND jsonb_typeof(last_task_snapshot_json)='object'
    AND last_task_projection IS NOT NULL
    AND last_task_snapshot_json->>'remoteTaskId'=remote_task_id
    AND last_task_snapshot_json->'providerIdentity'=provider_identity_json
    AND runtime_revision ~ '^(0|[1-9][0-9]*)$'
  ))
) IS TRUE);

ALTER TABLE remote_task_admission_intent
  ADD COLUMN dispatch_authority_snapshot_json jsonb,
  ADD COLUMN accepted_binding_id text GENERATED ALWAYS AS (
    CASE WHEN remote_receipt_json IS NOT NULL THEN binding_id END
  ) STORED REFERENCES remote_task_binding(binding_id) ON DELETE RESTRICT,
  ADD CONSTRAINT remote_task_dispatch_authority_check CHECK ((
    (dispatched_at IS NULL AND dispatch_authority_snapshot_json IS NULL)
    OR (dispatched_at IS NOT NULL AND jsonb_typeof(dispatch_authority_snapshot_json)='object'
      AND dispatch_authority_snapshot_json->>'schemaVersion'='1.0'
      AND jsonb_typeof(dispatch_authority_snapshot_json->'runtime')='object')
  ) IS TRUE),
  ADD CONSTRAINT remote_task_receipt_dispatch_authority_check CHECK ((
    remote_receipt_json IS NULL OR remote_receipt_json->'authoritySnapshot'=dispatch_authority_snapshot_json
  ) IS TRUE);

ALTER TABLE remote_task_observation DROP CONSTRAINT remote_task_observation_rejection_reason_check;
ALTER TABLE remote_task_observation ADD CONSTRAINT remote_task_observation_rejection_reason_check
  CHECK (rejection_reason IS NULL OR rejection_reason IN (
    'stale_provider_revision','binding_closed','identity_conflict','revision_content_conflict','terminal_conflict','input_key_conflict'));
-- Conflicting replay of a Provider event must remain visible, not be discarded by its event key.
DROP INDEX remote_task_observation_provider_event_idx;
CREATE UNIQUE INDEX remote_task_observation_provider_event_idx
  ON remote_task_observation(binding_id,provider_event_id,runtime_revision)
  WHERE provider_event_id IS NOT NULL AND accepted;

CREATE FUNCTION runtime_provider_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.binding_id,NEW.server_id,NEW.operation_name,NEW.remote_task_id,NEW.agent_task_id,
      NEW.context_id,NEW.mcp_invocation_id,NEW.authority_snapshot_json,NEW.binding_authority_json,
      NEW.provider_identity_json,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.binding_id,OLD.server_id,OLD.operation_name,OLD.remote_task_id,OLD.agent_task_id,
      OLD.context_id,OLD.mcp_invocation_id,OLD.authority_snapshot_json,OLD.binding_authority_json,
      OLD.provider_identity_json,OLD.created_at) THEN
    RAISE EXCEPTION 'REMOTE_TASK_IMMUTABLE_AUTHORITY_CONFLICT';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'REMOTE_TASK_BINDING_REVISION_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER runtime_provider_binding_immutable BEFORE UPDATE ON remote_task_binding
  FOR EACH ROW EXECUTE FUNCTION runtime_provider_binding_immutable();

CREATE FUNCTION runtime_remote_admission_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.local_envelope_json IS DISTINCT FROM OLD.local_envelope_json
    OR (OLD.dispatch_authority_snapshot_json IS NOT NULL AND
      NEW.dispatch_authority_snapshot_json IS DISTINCT FROM OLD.dispatch_authority_snapshot_json) THEN
    RAISE EXCEPTION 'REMOTE_TASK_DISPATCH_AUTHORITY_CONFLICT';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER runtime_remote_admission_immutable BEFORE UPDATE ON remote_task_admission_intent
  FOR EACH ROW EXECUTE FUNCTION runtime_remote_admission_immutable();

INSERT INTO schema_migration(version) VALUES ('0174_runtime_provider_binding_authority');
COMMIT;
