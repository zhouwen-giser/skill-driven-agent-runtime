--
-- SDAR v1.2.2 clean-slate PostgreSQL baseline.
-- Generated from the verified v1.2.1 schema, then normalized to the sole Frozen MCP Tasks V1
-- product contract. This file is applied only to an empty database; it is not an upgrade path.
--

-- Dumped from database version 17.10 (Debian 17.10-1.pgdg13+1)
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: enforce_remote_task_input_context_authority(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_remote_task_input_context_authority() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1
    FROM task_input_request request
    JOIN remote_task_binding binding ON binding.binding_id=NEW.binding_id
    WHERE request.input_request_id=NEW.input_request_id
      AND request.task_id=binding.agent_task_id
      AND request.context_id=binding.context_id
  ) THEN
    RAISE EXCEPTION 'REMOTE_TASK_INPUT_CONTEXT_AUTHORITY_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_task; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_task (
    task_id text NOT NULL,
    context_id text NOT NULL,
    user_id text NOT NULL,
    phase text NOT NULL,
    phase_message text NOT NULL,
    goal_id text,
    goal_version integer,
    output_text text,
    output_structured jsonb,
    error_code text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    request_text text NOT NULL,
    request_metadata jsonb NOT NULL,
    plan_id text,
    capability_gap_json jsonb,
    selected_skill_id text,
    selected_skill_version integer,
    skill_selection_id text,
    temporary_skill_id text,
    skill_input_resolution_id text,
    user_goal_plan_id text,
    skill_goal_id text,
    skill_attempt_id text,
    skill_execution_contract_id text,
    CONSTRAINT agent_task_check CHECK ((((goal_id IS NULL) AND (goal_version IS NULL)) OR ((goal_id IS NOT NULL) AND (goal_version IS NOT NULL)))),
    CONSTRAINT agent_task_phase_check CHECK ((phase = ANY (ARRAY['queued'::text, 'context_loading'::text, 'goal_deliberation'::text, 'skill_resolution'::text, 'planning'::text, 'awaiting_plan_confirmation'::text, 'awaiting_user_input'::text, 'paused'::text, 'executing'::text, 'evaluating'::text, 'capability_gap'::text, 'completed'::text, 'canceled'::text, 'failed'::text, 'invalidated'::text]))),
    CONSTRAINT agent_task_selected_skill_check CHECK ((((selected_skill_id IS NULL) AND (selected_skill_version IS NULL)) OR ((selected_skill_id IS NOT NULL) AND (selected_skill_version > 0)))),
    CONSTRAINT agent_task_skill_binding_check CHECK ((NOT ((selected_skill_id IS NOT NULL) AND (temporary_skill_id IS NOT NULL))))
);


--
-- Name: conversation_context; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_context (
    context_id text NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: evaluation_influence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluation_influence (
    influence_id text NOT NULL,
    report_id text NOT NULL,
    task_id text NOT NULL,
    experience_id text NOT NULL,
    skill_observation_id text,
    workflow_disposition text NOT NULL,
    workflow_template_id text,
    workflow_template_version integer,
    prompt_disposition text NOT NULL,
    prompt_id text,
    prompt_version integer,
    prompt_stage text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT evaluation_influence_check CHECK (((workflow_template_id IS NULL) = (workflow_template_version IS NULL))),
    CONSTRAINT evaluation_influence_check1 CHECK (((prompt_disposition = 'candidate_created'::text) = ((prompt_id IS NOT NULL) AND (prompt_version IS NOT NULL) AND (prompt_stage IS NOT NULL)))),
    CONSTRAINT evaluation_influence_prompt_disposition_check CHECK ((prompt_disposition = ANY (ARRAY['candidate_created'::text, 'not_required'::text]))),
    CONSTRAINT evaluation_influence_workflow_disposition_check CHECK ((workflow_disposition = ANY (ARRAY['quality_occurrence_recorded'::text, 'rejected_low_quality'::text])))
);


--
-- Name: evolution_experience; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evolution_experience (
    experience_id text NOT NULL,
    control_id text NOT NULL,
    round_index integer NOT NULL,
    task_id text,
    context_id text NOT NULL,
    goal_id text NOT NULL,
    goal_json jsonb NOT NULL,
    workflow_json jsonb NOT NULL,
    instance_id text NOT NULL,
    skill_versions_json jsonb NOT NULL,
    tools_json jsonb NOT NULL,
    input_json jsonb NOT NULL,
    result_json jsonb,
    errors_json jsonb NOT NULL,
    evaluation_json jsonb NOT NULL,
    successful boolean NOT NULL,
    duration_ms integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT evolution_experience_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT evolution_experience_round_index_check CHECK ((round_index >= 0))
);


--
-- Name: evolution_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evolution_policy (
    singleton boolean DEFAULT true NOT NULL,
    success_threshold integer NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT evolution_policy_singleton_check CHECK (singleton),
    CONSTRAINT evolution_policy_success_threshold_check CHECK ((success_threshold >= 2))
);


--
-- Name: evolution_trigger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evolution_trigger (
    trigger_id text NOT NULL,
    capability_fingerprint text NOT NULL,
    experience_id text NOT NULL,
    successful_experience_count integer NOT NULL,
    configured_threshold integer NOT NULL,
    decision text NOT NULL,
    candidate_id text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT evolution_trigger_configured_threshold_check CHECK ((configured_threshold >= 2)),
    CONSTRAINT evolution_trigger_decision_check CHECK ((decision = ANY (ARRAY['below_threshold'::text, 'candidate_created'::text, 'candidate_existing'::text]))),
    CONSTRAINT evolution_trigger_successful_experience_count_check CHECK ((successful_experience_count >= 1))
);


--
-- Name: external_task_projection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_task_projection (
    protocol text NOT NULL,
    task_id text NOT NULL,
    context_id text NOT NULL,
    state text NOT NULL,
    status_timestamp timestamp with time zone,
    document_json jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: goal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal (
    goal_id text NOT NULL,
    context_id text NOT NULL,
    version integer NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    constraints_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    success_criteria_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL,
    previous_goal_id text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT goal_status_check CHECK ((status = ANY (ARRAY['active'::text, 'achieved'::text, 'canceled'::text, 'unachievable'::text, 'superseded'::text]))),
    CONSTRAINT goal_version_check CHECK ((version > 0))
);


--
-- Name: goal_cancellation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal_cancellation (
    cancellation_id text NOT NULL,
    goal_id text NOT NULL,
    goal_version integer NOT NULL,
    reason text NOT NULL,
    canceled_task_ids_json jsonb NOT NULL,
    invalidated_plan_ids_json jsonb NOT NULL,
    canceled_instance_ids_json jsonb NOT NULL,
    warnings_json jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT goal_cancellation_goal_version_check CHECK ((goal_version > 0))
);


--
-- Name: goal_input_inference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal_input_inference (
    inference_id text NOT NULL,
    task_id text NOT NULL,
    context_id text NOT NULL,
    outcome text NOT NULL,
    decision_summary text NOT NULL,
    used_sources_json jsonb NOT NULL,
    inferred_goal_json jsonb,
    clarification_question text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT goal_input_inference_check CHECK ((((outcome = 'inferred'::text) AND (inferred_goal_json IS NOT NULL) AND (clarification_question IS NULL)) OR ((outcome = 'input_required'::text) AND (inferred_goal_json IS NULL) AND (clarification_question IS NOT NULL)))),
    CONSTRAINT goal_input_inference_outcome_check CHECK ((outcome = ANY (ARRAY['inferred'::text, 'input_required'::text])))
);


--
-- Name: goal_patch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal_patch (
    patch_id text NOT NULL,
    goal_id text NOT NULL,
    from_version integer NOT NULL,
    to_version integer NOT NULL,
    instruction text NOT NULL,
    changes_json jsonb NOT NULL,
    decision_summary text NOT NULL,
    compensation_warnings_json jsonb NOT NULL,
    invalidated_plan_ids_json jsonb NOT NULL,
    invalidated_instance_ids_json jsonb NOT NULL,
    new_plan_id text NOT NULL,
    before_goal_json jsonb NOT NULL,
    after_goal_json jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    triggering_task_id text,
    CONSTRAINT goal_patch_check CHECK ((to_version = (from_version + 1))),
    CONSTRAINT goal_patch_from_version_check CHECK ((from_version > 0))
);


--
-- Name: goal_transition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal_transition (
    transition_id text NOT NULL,
    context_id text NOT NULL,
    from_goal_id text NOT NULL,
    to_goal_id text NOT NULL,
    relationship text NOT NULL,
    decision_summary text NOT NULL,
    request_text text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT goal_transition_relationship_check CHECK ((relationship = ANY (ARRAY['related_successor'::text, 'unrelated_new'::text])))
);


--
-- Name: implicit_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.implicit_feedback (
    feedback_id text NOT NULL,
    kind text NOT NULL,
    source_task_id text NOT NULL,
    trigger_task_id text NOT NULL,
    context_id text NOT NULL,
    confidence double precision NOT NULL,
    evidence_summary text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT implicit_feedback_confidence_check CHECK (((confidence > (0)::double precision) AND (confidence <= (0.5)::double precision))),
    CONSTRAINT implicit_feedback_kind_check CHECK ((kind = ANY (ARRAY['accepted_result'::text, 'continued_modification'::text, 'repeated_submission'::text, 'requested_redo'::text, 'switched_skill'::text])))
);


--
-- Name: mcp_dependency_warning; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_dependency_warning (
    warning_id text NOT NULL,
    server_id text NOT NULL,
    tool_name text NOT NULL,
    reason text NOT NULL,
    skill_id text NOT NULL,
    skill_version integer NOT NULL,
    tool_revision integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    acknowledged_at timestamp with time zone,
    CONSTRAINT mcp_dependency_warning_reason_check CHECK ((reason = ANY (ARRAY['removed'::text, 'schema_changed'::text]))),
    CONSTRAINT mcp_dependency_warning_tool_revision_check CHECK ((tool_revision > 0))
);


--
-- Name: mcp_invocation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_invocation (
    invocation_id text NOT NULL,
    task_id text,
    context_id text,
    server_id text NOT NULL,
    tool_name text NOT NULL,
    arguments_json jsonb NOT NULL,
    result_json jsonb,
    status text NOT NULL,
    error_code text,
    error_message text,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone NOT NULL,
    duration_ms integer NOT NULL,
    execution_semantics_json jsonb DEFAULT '{"effect": "unknown", "replay": "unknown", "source": "default_unknown", "execution": "unknown", "idempotency": "unknown", "cancellation": "unknown"}'::jsonb NOT NULL,
    execution_mode text DEFAULT 'live'::text NOT NULL,
    simulation_id text,
    CONSTRAINT mcp_invocation_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT mcp_invocation_execution_context_check CHECK ((((execution_mode = 'live'::text) AND (simulation_id IS NULL)) OR ((execution_mode = ANY (ARRAY['simulation'::text, 'historical-replay'::text])) AND (length(btrim(simulation_id)) > 0)))),
    CONSTRAINT mcp_invocation_execution_semantics_object_check CHECK ((jsonb_typeof(execution_semantics_json) = 'object'::text)),
    CONSTRAINT mcp_invocation_status_check CHECK ((status = ANY (ARRAY['succeeded'::text, 'failed'::text, 'canceled'::text])))
);


--
-- Name: mcp_management_operation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_management_operation (
    operation_id text NOT NULL,
    server_id text NOT NULL,
    operation_type text NOT NULL,
    actor text NOT NULL,
    target text,
    summary_json jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    CONSTRAINT mcp_management_operation_actor_check CHECK ((actor = 'anonymous-management'::text)),
    CONSTRAINT mcp_management_operation_operation_type_check CHECK ((operation_type = ANY (ARRAY['register'::text, 'refresh'::text, 'health_check'::text, 'credentials_update'::text, 'tool_metadata_update'::text, 'tool_semantics_override'::text, 'delete'::text])))
);


--
-- Name: mcp_protocol_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_protocol_snapshot (
    snapshot_id text NOT NULL,
    server_id text NOT NULL,
    protocol_mode text NOT NULL,
    protocol_version text NOT NULL,
    baseline_sha256 text NOT NULL,
    supported_versions_json jsonb NOT NULL,
    capabilities_json jsonb NOT NULL,
    server_info_json jsonb NOT NULL,
    task_notifications boolean NOT NULL,
    discovered_at timestamp with time zone NOT NULL,
    valid_until timestamp with time zone,
    tool_revision integer NOT NULL,
    CONSTRAINT mcp_protocol_snapshot_baseline_sha256_check CHECK ((baseline_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT mcp_protocol_snapshot_capabilities_json_check CHECK ((jsonb_typeof(capabilities_json) = 'object'::text)),
    CONSTRAINT mcp_protocol_snapshot_check CHECK (((valid_until IS NULL) OR (valid_until > discovered_at))),
    CONSTRAINT mcp_protocol_snapshot_protocol_mode_check CHECK ((protocol_mode = 'frozen_v1'::text)),
    CONSTRAINT mcp_protocol_snapshot_protocol_version_check CHECK (((length(btrim(protocol_version)) >= 1) AND (length(btrim(protocol_version)) <= 128))),
    CONSTRAINT mcp_protocol_snapshot_server_info_json_check CHECK ((jsonb_typeof(server_info_json) = 'object'::text)),
    CONSTRAINT mcp_protocol_snapshot_snapshot_id_check CHECK (((length(btrim(snapshot_id)) >= 1) AND (length(btrim(snapshot_id)) <= 256))),
    CONSTRAINT mcp_protocol_snapshot_supported_versions_json_check CHECK ((jsonb_typeof(supported_versions_json) = 'array'::text)),
    CONSTRAINT mcp_protocol_snapshot_tool_revision_check CHECK ((tool_revision > 0))
);


--
-- Name: mcp_server; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_server (
    server_id text NOT NULL,
    name text NOT NULL,
    endpoint text NOT NULL,
    transport text NOT NULL,
    status text NOT NULL,
    tool_revision integer NOT NULL,
    encrypted_credential text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    protocol_mode text DEFAULT 'frozen_v1'::text NOT NULL,
    current_protocol_snapshot_id text,
    CONSTRAINT mcp_server_encrypted_credential_check CHECK ((encrypted_credential <> ''::text)),
    CONSTRAINT mcp_server_protocol_mode_check CHECK ((protocol_mode = 'frozen_v1'::text)),
    CONSTRAINT mcp_server_status_check CHECK ((status = ANY (ARRAY['enabled'::text, 'disabled'::text, 'unreachable'::text]))),
    CONSTRAINT mcp_server_tool_revision_check CHECK ((tool_revision > 0)),
    CONSTRAINT mcp_server_transport_check CHECK ((transport = 'streamable_http'::text))
);


--
-- Name: mcp_tool; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_tool (
    server_id text NOT NULL,
    tool_name text NOT NULL,
    title text,
    description text,
    input_schema_json jsonb NOT NULL,
    enhancement_json jsonb,
    discovered_at timestamp with time zone NOT NULL,
    task_execution_json jsonb,
    output_schema_json jsonb,
    declared_execution_semantics_json jsonb,
    admin_execution_semantics_override_json jsonb,
    execution_semantics_json jsonb DEFAULT '{"effect": "unknown", "replay": "unknown", "source": "default_unknown", "execution": "unknown", "idempotency": "unknown", "cancellation": "unknown"}'::jsonb NOT NULL,
    CONSTRAINT mcp_tool_admin_execution_semantics_override_object_check CHECK (((admin_execution_semantics_override_json IS NULL) OR (jsonb_typeof(admin_execution_semantics_override_json) = 'object'::text))),
    CONSTRAINT mcp_tool_declared_execution_semantics_object_check CHECK (((declared_execution_semantics_json IS NULL) OR (jsonb_typeof(declared_execution_semantics_json) = 'object'::text))),
    CONSTRAINT mcp_tool_execution_semantics_object_check CHECK ((jsonb_typeof(execution_semantics_json) = 'object'::text))
);


--
-- Name: memory_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_item (
    memory_id text NOT NULL,
    type text NOT NULL,
    content_json jsonb NOT NULL,
    summary text NOT NULL,
    status text NOT NULL,
    source_refs_json jsonb NOT NULL,
    supersedes_json jsonb NOT NULL,
    confidence double precision NOT NULL,
    embedding_provider_id text NOT NULL,
    embedding_dimensions integer NOT NULL,
    embedding public.vector NOT NULL,
    created_at timestamp with time zone NOT NULL,
    durability text NOT NULL,
    authority text NOT NULL,
    durability_reason text NOT NULL,
    CONSTRAINT memory_item_authority_check CHECK ((authority = ANY (ARRAY['mcp'::text, 'skill_experience'::text, 'admin'::text, 'model_inferred'::text]))),
    CONSTRAINT memory_item_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))),
    CONSTRAINT memory_item_durability_check CHECK ((durability = ANY (ARRAY['durable'::text, 'volatile'::text, 'unknown'::text]))),
    CONSTRAINT memory_item_durability_reason_check CHECK ((length(btrim(durability_reason)) > 0)),
    CONSTRAINT memory_item_embedding_dimensions_check CHECK (((embedding_dimensions > 0) AND (public.vector_dims(embedding) = embedding_dimensions))),
    CONSTRAINT memory_item_status_check CHECK ((status = ANY (ARRAY['active'::text, 'superseded'::text, 'invalid'::text]))),
    CONSTRAINT memory_item_type_check CHECK ((type = ANY (ARRAY['fact'::text, 'success_experience'::text, 'failure_experience'::text, 'workflow_pattern'::text, 'skill_learning'::text, 'prompt_learning'::text])))
);


--
-- Name: memory_retention_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_retention_policy (
    singleton boolean DEFAULT true NOT NULL,
    review_after_days integer NOT NULL,
    archive_after_days integer,
    delete_after_days integer,
    automatic_archive_enabled boolean NOT NULL,
    automatic_delete_enabled boolean NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT memory_retention_policy_archive_after_days_check CHECK ((archive_after_days > 0)),
    CONSTRAINT memory_retention_policy_automatic_archive_enabled_check CHECK ((NOT automatic_archive_enabled)),
    CONSTRAINT memory_retention_policy_automatic_delete_enabled_check CHECK ((NOT automatic_delete_enabled)),
    CONSTRAINT memory_retention_policy_check CHECK (((archive_after_days IS NULL) OR (delete_after_days IS NULL) OR (delete_after_days > archive_after_days))),
    CONSTRAINT memory_retention_policy_delete_after_days_check CHECK ((delete_after_days > 0)),
    CONSTRAINT memory_retention_policy_review_after_days_check CHECK ((review_after_days > 0)),
    CONSTRAINT memory_retention_policy_singleton_check CHECK (singleton)
);


--
-- Name: memory_status_transition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_status_transition (
    transition_id text NOT NULL,
    memory_id text NOT NULL,
    from_status text NOT NULL,
    to_status text NOT NULL,
    replacement_memory_id text,
    actor text NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT memory_status_transition_from_status_check CHECK ((from_status = ANY (ARRAY['active'::text, 'superseded'::text, 'invalid'::text]))),
    CONSTRAINT memory_status_transition_to_status_check CHECK ((to_status = ANY (ARRAY['superseded'::text, 'invalid'::text])))
);


--
-- Name: model_invocation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_invocation (
    invocation_id text NOT NULL,
    stage text NOT NULL,
    provider_id text NOT NULL,
    model text NOT NULL,
    operation text NOT NULL,
    request_json jsonb NOT NULL,
    context_json jsonb NOT NULL,
    raw_response_json jsonb,
    structured_result_json jsonb,
    input_tokens integer,
    output_tokens integer,
    duration_ms integer NOT NULL,
    status text NOT NULL,
    error_code text,
    error_message text,
    created_at timestamp with time zone NOT NULL,
    prompt_id text,
    prompt_version integer,
    task_id text,
    CONSTRAINT model_invocation_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT model_invocation_input_tokens_check CHECK (((input_tokens IS NULL) OR (input_tokens >= 0))),
    CONSTRAINT model_invocation_operation_check CHECK ((operation = ANY (ARRAY['structured_generation'::text, 'embedding'::text]))),
    CONSTRAINT model_invocation_output_tokens_check CHECK (((output_tokens IS NULL) OR (output_tokens >= 0))),
    CONSTRAINT model_invocation_status_check CHECK ((status = ANY (ARRAY['succeeded'::text, 'failed'::text])))
);


--
-- Name: model_provider; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_provider (
    provider_id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    base_url text NOT NULL,
    model text NOT NULL,
    enabled boolean NOT NULL,
    timeout_ms integer NOT NULL,
    encrypted_credential text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    api_style text DEFAULT 'openai_chat_completions'::text NOT NULL,
    CONSTRAINT model_provider_api_style_check CHECK ((api_style = ANY (ARRAY['openai_chat_completions'::text, 'anthropic_messages'::text]))),
    CONSTRAINT model_provider_kind_check CHECK ((kind = ANY (ARRAY['openai_compatible'::text, 'local'::text, 'other_vendor'::text]))),
    CONSTRAINT model_provider_timeout_ms_check CHECK ((timeout_ms > 0))
);


--
-- Name: processed_result; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_result (
    result_id text NOT NULL,
    task_id text NOT NULL,
    skill_id text NOT NULL,
    skill_version integer NOT NULL,
    normalized_json jsonb NOT NULL,
    output_json jsonb NOT NULL,
    facts_json jsonb NOT NULL,
    valuable boolean NOT NULL,
    value_summary text NOT NULL,
    memory_candidates_json jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT processed_result_skill_version_check CHECK ((skill_version > 0))
);


--
-- Name: prompt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prompt (
    prompt_id text NOT NULL,
    stage text NOT NULL,
    current_version integer,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: prompt_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prompt_version (
    prompt_id text NOT NULL,
    stage text NOT NULL,
    version integer NOT NULL,
    previous_version integer,
    content text NOT NULL,
    status text NOT NULL,
    source text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT prompt_version_source_check CHECK ((source = ANY (ARRAY['admin'::text, 'auto_candidate'::text, 'manual_correction'::text, 'rollback'::text]))),
    CONSTRAINT prompt_version_status_check CHECK ((status = ANY (ARRAY['candidate'::text, 'enabled'::text, 'disabled'::text]))),
    CONSTRAINT prompt_version_version_check CHECK ((version > 0))
);


--
-- Name: remote_task_binding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_task_binding (
    binding_id text NOT NULL,
    server_id text NOT NULL,
    operation_name text NOT NULL,
    remote_task_id text NOT NULL,
    agent_task_id text NOT NULL,
    context_id text NOT NULL,
    goal_id text NOT NULL,
    goal_version integer NOT NULL,
    workflow_plan_id text NOT NULL,
    workflow_definition_id text NOT NULL,
    workflow_definition_version integer NOT NULL,
    workflow_instance_id text NOT NULL,
    workflow_node_id text NOT NULL,
    workflow_node_run_id text NOT NULL,
    parent_workflow_instance_id text,
    parent_skill_call_id text,
    mcp_invocation_id text NOT NULL,
    protocol_status text NOT NULL,
    protocol_revision text NOT NULL,
    tasks_schema_revision text NOT NULL,
    provider_substate text,
    remote_revision text,
    last_provider_updated_at timestamp with time zone NOT NULL,
    local_state text NOT NULL,
    requested_timing_json jsonb,
    execution_mode text NOT NULL,
    simulation_id text,
    credential_revision text NOT NULL,
    session_revision text NOT NULL,
    poll_interval_ms integer NOT NULL,
    next_poll_at timestamp with time zone,
    poll_attempt integer DEFAULT 0 NOT NULL,
    provider_failure_count integer DEFAULT 0 NOT NULL,
    poll_claim_token text,
    poll_claimed_at timestamp with time zone,
    poll_claim_expires_at timestamp with time zone,
    result_snapshot_json jsonb,
    error_snapshot_json jsonb,
    last_safe_error_code text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    invalidated_at timestamp with time zone,
    terminal_at timestamp with time zone,
    version bigint DEFAULT 1 NOT NULL,
    protocol_contract_json jsonb DEFAULT '{"mode": "frozen_v1", "baselineSha256": "9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708", "protocolVersion": "2026-07-28"}'::jsonb NOT NULL,
    task_behavior text,
    runtime_revision text,
    provider_revision text,
    task_ttl_ms bigint,
    task_expires_at timestamp with time zone,
    CONSTRAINT remote_task_binding_binding_id_check CHECK (((length(btrim(binding_id)) >= 1) AND (length(btrim(binding_id)) <= 256))),
    CONSTRAINT remote_task_binding_check CHECK ((((execution_mode = 'live'::text) AND (simulation_id IS NULL)) OR ((execution_mode = ANY (ARRAY['simulation'::text, 'historical-replay'::text])) AND ((length(btrim(simulation_id)) >= 1) AND (length(btrim(simulation_id)) <= 256)) AND (simulation_id ~ '^[!-~]+$'::text)))),
    CONSTRAINT remote_task_binding_check1 CHECK ((((poll_claim_token IS NULL) AND (poll_claimed_at IS NULL) AND (poll_claim_expires_at IS NULL)) OR ((length(btrim(poll_claim_token)) > 0) AND (poll_claimed_at IS NOT NULL) AND (poll_claim_expires_at > poll_claimed_at)))),
    CONSTRAINT remote_task_binding_check3 CHECK (((terminal_at IS NULL) OR (protocol_status = ANY (ARRAY['completed'::text, 'failed'::text, 'cancelled'::text])))),
    CONSTRAINT remote_task_binding_credential_revision_check CHECK ((length(btrim(credential_revision)) > 0)),
    CONSTRAINT remote_task_binding_error_snapshot_json_check CHECK (((error_snapshot_json IS NULL) OR (octet_length((error_snapshot_json)::text) <= 1048576))),
    CONSTRAINT remote_task_binding_execution_mode_check CHECK ((execution_mode = ANY (ARRAY['live'::text, 'simulation'::text, 'historical-replay'::text]))),
    CONSTRAINT remote_task_binding_frozen_authority_check CHECK ((((protocol_contract_json ->> 'mode'::text) <> 'frozen_v1'::text) OR ((task_behavior IS NOT NULL) AND (runtime_revision IS NOT NULL)))),
    CONSTRAINT remote_task_binding_goal_version_check CHECK ((goal_version > 0)),
    CONSTRAINT remote_task_binding_local_state_check CHECK ((local_state = ANY (ARRAY['polling'::text, 'cancel_observing'::text, 'awaiting_input'::text, 'terminal_event_pending'::text, 'terminal_event_claimed'::text, 'reentered'::text, 'closed'::text, 'quarantined'::text]))),
    CONSTRAINT remote_task_binding_next_poll_state_check CHECK (((next_poll_at IS NULL) OR (local_state = ANY (ARRAY['polling'::text, 'cancel_observing'::text])))),
    CONSTRAINT remote_task_binding_operation_name_check CHECK (((length(btrim(operation_name)) >= 1) AND (length(btrim(operation_name)) <= 512))),
    CONSTRAINT remote_task_binding_poll_attempt_check CHECK ((poll_attempt >= 0)),
    CONSTRAINT remote_task_binding_poll_interval_ms_check CHECK (((poll_interval_ms >= 100) AND (poll_interval_ms <= 86400000))),
    CONSTRAINT remote_task_binding_protocol_contract_object_check CHECK ((jsonb_typeof(protocol_contract_json) = 'object'::text)),
    CONSTRAINT remote_task_binding_protocol_revision_check CHECK ((length(btrim(protocol_revision)) > 0)),
    CONSTRAINT remote_task_binding_protocol_status_check CHECK ((protocol_status = ANY (ARRAY['working'::text, 'input_required'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT remote_task_binding_provider_failure_count_check CHECK ((provider_failure_count >= 0)),
    CONSTRAINT remote_task_binding_provider_substate_check CHECK (((provider_substate IS NULL) OR (provider_substate = ANY (ARRAY['scheduled'::text, 'queued'::text, 'running'::text, 'paused'::text, 'resuming'::text, 'stopping'::text])))),
    CONSTRAINT remote_task_binding_remote_task_id_check CHECK ((((length(remote_task_id) >= 1) AND (length(remote_task_id) <= 512)) AND (remote_task_id ~ '^[!-~]+$'::text))),
    CONSTRAINT remote_task_binding_requested_timing_json_check CHECK (((requested_timing_json IS NULL) OR (octet_length((requested_timing_json)::text) <= 1048576))),
    CONSTRAINT remote_task_binding_result_snapshot_json_check CHECK (((result_snapshot_json IS NULL) OR (octet_length((result_snapshot_json)::text) <= 1048576))),
    CONSTRAINT remote_task_binding_runtime_revision_check CHECK (((runtime_revision IS NULL) OR (runtime_revision ~ '^(0|[1-9][0-9]*)$'::text))),
    CONSTRAINT remote_task_binding_server_id_check CHECK (((length(btrim(server_id)) >= 1) AND (length(btrim(server_id)) <= 256))),
    CONSTRAINT remote_task_binding_session_revision_check CHECK ((length(btrim(session_revision)) > 0)),
    CONSTRAINT remote_task_binding_task_behavior_check CHECK (((task_behavior IS NULL) OR (task_behavior = ANY (ARRAY['synchronous_only'::text, 'server_directed'::text, 'task_required'::text])))),
    CONSTRAINT remote_task_binding_task_ttl_ms_check CHECK (((task_ttl_ms IS NULL) OR (task_ttl_ms > 0))),
    CONSTRAINT remote_task_binding_tasks_schema_revision_check CHECK ((length(btrim(tasks_schema_revision)) > 0)),
    CONSTRAINT remote_task_binding_ttl_expiry_check CHECK ((((task_ttl_ms IS NULL) AND (task_expires_at IS NULL)) OR ((task_ttl_ms IS NOT NULL) AND (task_expires_at IS NOT NULL)))),
    CONSTRAINT remote_task_binding_version_check CHECK ((version > 0)),
    CONSTRAINT remote_task_binding_workflow_definition_id_check CHECK ((length(btrim(workflow_definition_id)) > 0)),
    CONSTRAINT remote_task_binding_workflow_definition_version_check CHECK ((workflow_definition_version > 0)),
    CONSTRAINT remote_task_binding_workflow_node_id_check CHECK ((length(btrim(workflow_node_id)) > 0)),
    CONSTRAINT remote_task_binding_workflow_node_run_id_check CHECK (((length(btrim(workflow_node_run_id)) >= 1) AND (length(btrim(workflow_node_run_id)) <= 1024)))
);


--
-- Name: remote_task_cancel_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_task_cancel_attempt (
    attempt_id text NOT NULL,
    cancel_request_id text NOT NULL,
    binding_id text NOT NULL,
    expected_request_version bigint NOT NULL,
    method text NOT NULL,
    protocol_revision text NOT NULL,
    status text NOT NULL,
    error_code text,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone NOT NULL,
    duration_ms bigint NOT NULL,
    CONSTRAINT remote_task_cancel_attempt_attempt_id_check CHECK (((length(btrim(attempt_id)) >= 1) AND (length(btrim(attempt_id)) <= 256))),
    CONSTRAINT remote_task_cancel_attempt_check CHECK ((completed_at >= started_at)),
    CONSTRAINT remote_task_cancel_attempt_check1 CHECK ((((status = 'acknowledged'::text) AND (error_code IS NULL)) OR ((status <> 'acknowledged'::text) AND (error_code IS NOT NULL)))),
    CONSTRAINT remote_task_cancel_attempt_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT remote_task_cancel_attempt_error_code_check CHECK (((error_code IS NULL) OR ((length(btrim(error_code)) >= 1) AND (length(btrim(error_code)) <= 256)))),
    CONSTRAINT remote_task_cancel_attempt_expected_request_version_check CHECK ((expected_request_version > 0)),
    CONSTRAINT remote_task_cancel_attempt_method_check CHECK ((method = 'tasks/cancel'::text)),
    CONSTRAINT remote_task_cancel_attempt_protocol_revision_check CHECK (((length(btrim(protocol_revision)) >= 1) AND (length(btrim(protocol_revision)) <= 256))),
    CONSTRAINT remote_task_cancel_attempt_status_check CHECK ((status = ANY (ARRAY['acknowledged'::text, 'provider_unreachable'::text, 'contract_invalid'::text, 'provider_protocol'::text, 'stale_terminal'::text])))
);


--
-- Name: remote_task_cancel_request; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_task_cancel_request (
    cancel_request_id text NOT NULL,
    binding_id text NOT NULL,
    idempotency_key text NOT NULL,
    source text NOT NULL,
    reason_code text NOT NULL,
    summary text NOT NULL,
    delivery_status text NOT NULL,
    provider_terminal_status text,
    protocol_revision text,
    acknowledged_at timestamp with time zone,
    resolved_at timestamp with time zone,
    claim_token text,
    claimed_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_safe_error_code text,
    requested_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT remote_task_cancel_request_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT remote_task_cancel_request_cancel_request_id_check CHECK (((length(btrim(cancel_request_id)) >= 1) AND (length(btrim(cancel_request_id)) <= 256))),
    CONSTRAINT remote_task_cancel_request_check CHECK ((updated_at >= requested_at)),
    CONSTRAINT remote_task_cancel_request_check1 CHECK ((((claim_token IS NULL) AND (claimed_at IS NULL) AND (claim_expires_at IS NULL)) OR (((length(btrim(claim_token)) >= 1) AND (length(btrim(claim_token)) <= 256)) AND (claimed_at IS NOT NULL) AND (claim_expires_at > claimed_at)))),
    CONSTRAINT remote_task_cancel_request_check2 CHECK ((((delivery_status = 'acknowledged'::text) AND (protocol_revision IS NOT NULL) AND (acknowledged_at IS NOT NULL)) OR (delivery_status <> 'acknowledged'::text))),
    CONSTRAINT remote_task_cancel_request_check3 CHECK ((((provider_terminal_status IS NULL) AND (resolved_at IS NULL)) OR ((provider_terminal_status IS NOT NULL) AND (resolved_at IS NOT NULL)))),
    CONSTRAINT remote_task_cancel_request_delivery_status_check CHECK ((delivery_status = ANY (ARRAY['requested'::text, 'acknowledged'::text, 'uncertain'::text]))),
    CONSTRAINT remote_task_cancel_request_idempotency_key_check CHECK (((length(btrim(idempotency_key)) >= 1) AND (length(btrim(idempotency_key)) <= 256))),
    CONSTRAINT remote_task_cancel_request_last_safe_error_code_check CHECK (((last_safe_error_code IS NULL) OR ((length(btrim(last_safe_error_code)) >= 1) AND (length(btrim(last_safe_error_code)) <= 256)))),
    CONSTRAINT remote_task_cancel_request_protocol_revision_check CHECK (((protocol_revision IS NULL) OR ((length(btrim(protocol_revision)) >= 1) AND (length(btrim(protocol_revision)) <= 256)))),
    CONSTRAINT remote_task_cancel_request_provider_terminal_status_check CHECK (((provider_terminal_status IS NULL) OR (provider_terminal_status = ANY (ARRAY['completed'::text, 'failed'::text, 'cancelled'::text])))),
    CONSTRAINT remote_task_cancel_request_reason_code_check CHECK (((length(btrim(reason_code)) >= 1) AND (length(btrim(reason_code)) <= 128))),
    CONSTRAINT remote_task_cancel_request_source_check CHECK ((source = ANY (ARRAY['task'::text, 'goal'::text, 'workflow'::text, 'management'::text, 'compensation'::text]))),
    CONSTRAINT remote_task_cancel_request_summary_check CHECK (((length(btrim(summary)) >= 1) AND (length(btrim(summary)) <= 2048))),
    CONSTRAINT remote_task_cancel_request_version_check CHECK ((version > 0))
);


--
-- Name: remote_task_control_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_task_control_event (
    event_id text NOT NULL,
    binding_id text NOT NULL,
    event_type text NOT NULL,
    remote_revision text NOT NULL,
    result_hash text NOT NULL,
    payload_json jsonb NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    claimed_at timestamp with time zone,
    processed_at timestamp with time zone,
    error_code text,
    continuation_claim_token text,
    continuation_claim_expires_at timestamp with time zone,
    continuation_claim_attempt integer DEFAULT 0 NOT NULL,
    runtime_revision text,
    CONSTRAINT remote_task_control_continuation_claim_check CHECK ((((continuation_claim_token IS NULL) AND (continuation_claim_expires_at IS NULL)) OR (((length(btrim(continuation_claim_token)) >= 1) AND (length(btrim(continuation_claim_token)) <= 256)) AND (claimed_at IS NOT NULL) AND (continuation_claim_expires_at > claimed_at)))),
    CONSTRAINT remote_task_control_event_check CHECK ((((status = 'pending'::text) AND (claimed_at IS NULL) AND (processed_at IS NULL)) OR ((status = 'claimed'::text) AND (claimed_at IS NOT NULL) AND (processed_at IS NULL)) OR ((status = ANY (ARRAY['processed'::text, 'failed'::text])) AND (claimed_at IS NOT NULL) AND (processed_at IS NOT NULL)))),
    CONSTRAINT remote_task_control_event_continuation_claim_attempt_check CHECK ((continuation_claim_attempt >= 0)),
    CONSTRAINT remote_task_control_event_event_id_check CHECK (((length(btrim(event_id)) >= 1) AND (length(btrim(event_id)) <= 256))),
    CONSTRAINT remote_task_control_event_event_type_check CHECK ((event_type = ANY (ARRAY['task.input_required'::text, 'task.completed'::text, 'task.failed'::text, 'task.cancelled'::text]))),
    CONSTRAINT remote_task_control_event_payload_json_check CHECK ((octet_length((payload_json)::text) <= 1048576)),
    CONSTRAINT remote_task_control_event_remote_revision_check CHECK ((length(btrim(remote_revision)) > 0)),
    CONSTRAINT remote_task_control_event_result_hash_check CHECK ((result_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT remote_task_control_event_runtime_revision_check CHECK (((runtime_revision IS NULL) OR (runtime_revision ~ '^(0|[1-9][0-9]*)$'::text))),
    CONSTRAINT remote_task_control_event_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text, 'processed'::text, 'failed'::text])))
);


--
-- Name: remote_task_input_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_task_input_attempt (
    attempt_id text NOT NULL,
    input_request_id text NOT NULL,
    binding_id text NOT NULL,
    expected_binding_version bigint NOT NULL,
    method text NOT NULL,
    status text NOT NULL,
    protocol_revision text,
    error_code text,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone NOT NULL,
    duration_ms bigint NOT NULL,
    CONSTRAINT remote_task_input_attempt_attempt_id_check CHECK (((length(btrim(attempt_id)) >= 1) AND (length(btrim(attempt_id)) <= 256))),
    CONSTRAINT remote_task_input_attempt_check CHECK ((completed_at >= started_at)),
    CONSTRAINT remote_task_input_attempt_check1 CHECK ((((status = 'acknowledged'::text) AND (protocol_revision IS NOT NULL) AND (error_code IS NULL)) OR ((status <> 'acknowledged'::text) AND (error_code IS NOT NULL)))),
    CONSTRAINT remote_task_input_attempt_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT remote_task_input_attempt_error_code_check CHECK (((error_code IS NULL) OR ((length(btrim(error_code)) >= 1) AND (length(btrim(error_code)) <= 256)))),
    CONSTRAINT remote_task_input_attempt_expected_binding_version_check CHECK ((expected_binding_version > 0)),
    CONSTRAINT remote_task_input_attempt_method_check CHECK ((method = 'tasks/update'::text)),
    CONSTRAINT remote_task_input_attempt_protocol_revision_check CHECK (((protocol_revision IS NULL) OR ((length(btrim(protocol_revision)) >= 1) AND (length(btrim(protocol_revision)) <= 256)))),
    CONSTRAINT remote_task_input_attempt_status_check CHECK ((status = ANY (ARRAY['acknowledged'::text, 'provider_unreachable'::text, 'contract_invalid'::text, 'provider_protocol'::text])))
);


--
-- Name: remote_task_input_link; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_task_input_link (
    input_request_id text NOT NULL,
    control_event_id text NOT NULL,
    binding_id text NOT NULL,
    remote_task_id text NOT NULL,
    workflow_instance_id text NOT NULL,
    workflow_node_id text NOT NULL,
    workflow_node_run_id text NOT NULL,
    remote_revision text NOT NULL,
    result_hash text NOT NULL,
    input_requests_json jsonb NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT remote_task_input_link_check CHECK ((updated_at >= created_at)),
    CONSTRAINT remote_task_input_link_input_requests_json_check CHECK ((octet_length((input_requests_json)::text) <= 1048576)),
    CONSTRAINT remote_task_input_link_remote_revision_check CHECK (((length(btrim(remote_revision)) >= 1) AND (length(btrim(remote_revision)) <= 1024))),
    CONSTRAINT remote_task_input_link_remote_task_id_check CHECK ((((length(remote_task_id) >= 1) AND (length(remote_task_id) <= 512)) AND (remote_task_id ~ '^[!-~]+$'::text))),
    CONSTRAINT remote_task_input_link_result_hash_check CHECK ((result_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT remote_task_input_link_status_check CHECK ((status = ANY (ARRAY['waiting'::text, 'answered'::text, 'update_acknowledged'::text, 'update_uncertain'::text, 'provider_advanced'::text]))),
    CONSTRAINT remote_task_input_link_workflow_node_id_check CHECK (((length(btrim(workflow_node_id)) >= 1) AND (length(btrim(workflow_node_id)) <= 256))),
    CONSTRAINT remote_task_input_link_workflow_node_run_id_check CHECK (((length(btrim(workflow_node_run_id)) >= 1) AND (length(btrim(workflow_node_run_id)) <= 1024)))
);


--
-- Name: remote_task_observation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_task_observation (
    observation_id text NOT NULL,
    binding_id text NOT NULL,
    sequence bigint NOT NULL,
    observation_type text NOT NULL,
    provider_event_id text,
    remote_revision text,
    payload_json jsonb NOT NULL,
    accepted boolean NOT NULL,
    rejection_reason text,
    observed_at timestamp with time zone NOT NULL,
    observation_source text DEFAULT 'poll'::text NOT NULL,
    runtime_revision text,
    provider_revision text,
    subscription_id text,
    CONSTRAINT remote_task_observation_check CHECK (((accepted AND (rejection_reason IS NULL)) OR ((NOT accepted) AND (rejection_reason IS NOT NULL)))),
    CONSTRAINT remote_task_observation_observation_id_check CHECK (((length(btrim(observation_id)) >= 1) AND (length(btrim(observation_id)) <= 256))),
    CONSTRAINT remote_task_observation_observation_source_check CHECK ((observation_source = ANY (ARRAY['admission'::text, 'poll'::text, 'notification'::text, 'reconciliation'::text]))),
    CONSTRAINT remote_task_observation_observation_type_check CHECK ((observation_type = ANY (ARRAY['task.accepted'::text, 'task.snapshot'::text, 'task.scheduled'::text, 'task.started'::text, 'task.paused'::text, 'task.resumed'::text, 'task.progress'::text, 'task.heartbeat'::text, 'provider_unreachable'::text, 'schema_invalid'::text]))),
    CONSTRAINT remote_task_observation_payload_json_check CHECK ((octet_length((payload_json)::text) <= 1048576)),
    CONSTRAINT remote_task_observation_rejection_reason_check CHECK (((rejection_reason IS NULL) OR (rejection_reason = ANY (ARRAY['stale_provider_revision'::text, 'binding_closed'::text])))),
    CONSTRAINT remote_task_observation_runtime_revision_check CHECK (((runtime_revision IS NULL) OR (runtime_revision ~ '^(0|[1-9][0-9]*)$'::text))),
    CONSTRAINT remote_task_observation_sequence_check CHECK ((sequence > 0))
);


--
-- Name: remote_task_protocol_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_task_protocol_attempt (
    attempt_id text NOT NULL,
    binding_id text NOT NULL,
    method text NOT NULL,
    expected_binding_version bigint NOT NULL,
    protocol_revision text NOT NULL,
    status text NOT NULL,
    error_code text,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone NOT NULL,
    duration_ms bigint NOT NULL,
    CONSTRAINT remote_task_protocol_attempt_attempt_id_check CHECK (((length(btrim(attempt_id)) >= 1) AND (length(btrim(attempt_id)) <= 256))),
    CONSTRAINT remote_task_protocol_attempt_check CHECK ((completed_at >= started_at)),
    CONSTRAINT remote_task_protocol_attempt_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT remote_task_protocol_attempt_expected_binding_version_check CHECK ((expected_binding_version > 0)),
    CONSTRAINT remote_task_protocol_attempt_method_check CHECK ((method = 'tasks/get'::text)),
    CONSTRAINT remote_task_protocol_attempt_protocol_revision_check CHECK ((length(btrim(protocol_revision)) > 0)),
    CONSTRAINT remote_task_protocol_attempt_status_check CHECK ((status = ANY (ARRAY['succeeded'::text, 'provider_unreachable'::text, 'contract_invalid'::text, 'provider_protocol'::text])))
);


--
-- Name: runtime_bootstrap_probe; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_bootstrap_probe (
    id bigint NOT NULL,
    label text NOT NULL,
    embedding public.vector(3) NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: runtime_bootstrap_probe_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.runtime_bootstrap_probe ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.runtime_bootstrap_probe_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: runtime_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_event (
    event_id text NOT NULL,
    task_id text NOT NULL,
    context_id text NOT NULL,
    event_type text NOT NULL,
    event_timestamp timestamp with time zone NOT NULL,
    summary text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: runtime_terminal_outcome; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_terminal_outcome (
    outcome_id text NOT NULL,
    outcome_kind text NOT NULL,
    task_id text,
    goal_id text NOT NULL,
    goal_version integer NOT NULL,
    control_id text NOT NULL,
    control_status text NOT NULL,
    round_index integer,
    final_instance_id text,
    result_id text,
    summary text NOT NULL,
    authority text NOT NULL DEFAULT 'user_goal_plan_controller',
    enhancement_warnings_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    committed_at timestamp with time zone NOT NULL,
    CONSTRAINT runtime_terminal_outcome_check CHECK (((outcome_kind <> 'achieved'::text) OR (control_status = 'achieved'::text))),
    CONSTRAINT runtime_terminal_outcome_check1 CHECK (((outcome_kind <> 'unachievable'::text) OR (control_status = ANY (ARRAY['unachievable'::text, 'replan_budget_exhausted'::text])))),
    CONSTRAINT runtime_terminal_outcome_check2 CHECK (((outcome_kind <> 'canceled'::text) OR (control_status = 'canceled'::text))),
    CONSTRAINT runtime_terminal_outcome_check3 CHECK (((outcome_kind = 'canceled'::text) OR ((round_index IS NOT NULL) AND (final_instance_id IS NOT NULL)))),
    CONSTRAINT runtime_terminal_outcome_control_status_check CHECK ((control_status = ANY (ARRAY['achieved'::text, 'unachievable'::text, 'canceled'::text, 'replan_budget_exhausted'::text]))),
    CONSTRAINT runtime_terminal_outcome_goal_version_check CHECK ((goal_version > 0)),
    CONSTRAINT runtime_terminal_outcome_outcome_kind_check CHECK ((outcome_kind = ANY (ARRAY['achieved'::text, 'unachievable'::text, 'canceled'::text]))),
    CONSTRAINT runtime_terminal_outcome_round_index_check CHECK ((round_index >= 0)),
    CONSTRAINT runtime_terminal_outcome_authority_check CHECK ((authority = 'user_goal_plan_controller'::text))
);


--
-- Name: schema_migration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migration (
    version text NOT NULL,
    applied_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: skill; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill (
    skill_id text NOT NULL,
    current_version integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: skill_call_workflow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_call_workflow (
    parent_instance_id text NOT NULL,
    parent_node_id text NOT NULL,
    child_instance_id text,
    child_plan_id text NOT NULL,
    skill_id text NOT NULL,
    skill_version integer NOT NULL,
    status text NOT NULL,
    evaluation_summary text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    call_id text NOT NULL,
    parent_plan_id text NOT NULL,
    confirmation_status text NOT NULL,
    CONSTRAINT skill_call_workflow_confirmation_status_check CHECK ((confirmation_status = ANY (ARRAY['awaiting_confirmation'::text, 'confirmed'::text, 'rejected'::text, 'invalidated'::text]))),
    CONSTRAINT skill_call_workflow_skill_version_check CHECK ((skill_version > 0)),
    CONSTRAINT skill_call_workflow_status_check CHECK ((status = ANY (ARRAY['awaiting_confirmation'::text, 'running'::text, 'waiting_external'::text, 'succeeded'::text, 'failed'::text, 'canceled'::text, 'rejected'::text, 'invalidated'::text])))
);


--
-- Name: skill_draft; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_draft (
    draft_id text NOT NULL,
    task_id text NOT NULL,
    context_id text NOT NULL,
    requested_by text NOT NULL,
    intent text NOT NULL,
    request_text text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    published_skill_id text,
    published_skill_version integer,
    published_by text,
    published_at timestamp with time zone,
    CONSTRAINT skill_draft_intent_check CHECK ((intent = ANY (ARRAY['create'::text, 'update'::text]))),
    CONSTRAINT skill_draft_publication_check CHECK ((((status = 'draft'::text) AND (published_skill_id IS NULL) AND (published_skill_version IS NULL) AND (published_by IS NULL) AND (published_at IS NULL)) OR ((status = 'published'::text) AND (published_skill_id IS NOT NULL) AND (published_skill_version IS NOT NULL) AND (published_by IS NOT NULL) AND (published_at IS NOT NULL)))),
    CONSTRAINT skill_draft_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))
);


--
-- Name: skill_embedding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_embedding (
    skill_id text NOT NULL,
    skill_version integer NOT NULL,
    provider_id text NOT NULL,
    dimensions integer NOT NULL,
    searchable_text text NOT NULL,
    embedding public.vector NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT skill_embedding_dimensions_check CHECK ((dimensions > 0))
);


--
-- Name: skill_evolution_correction_experience; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_evolution_correction_experience (
    correction_id text NOT NULL,
    candidate_id text NOT NULL,
    capability_fingerprint text NOT NULL,
    actor text NOT NULL,
    summary text NOT NULL,
    before_skill_json jsonb NOT NULL,
    after_skill_json jsonb NOT NULL,
    diff_json jsonb NOT NULL,
    validation_report_json jsonb NOT NULL,
    outcome text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT skill_evolution_correction_experience_actor_check CHECK ((length(TRIM(BOTH FROM actor)) > 0)),
    CONSTRAINT skill_evolution_correction_experience_outcome_check CHECK ((outcome = ANY (ARRAY['validation_failed'::text, 'published'::text]))),
    CONSTRAINT skill_evolution_correction_experience_summary_check CHECK ((length(TRIM(BOTH FROM summary)) > 0))
);


--
-- Name: skill_execution_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_execution_event (
    event_id text NOT NULL,
    sequence_number bigint NOT NULL,
    execution_id text NOT NULL,
    event_type text NOT NULL,
    status_after text,
    summary text NOT NULL,
    details_json jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    CONSTRAINT skill_execution_event_details_json_check CHECK ((jsonb_typeof(details_json) = 'object'::text)),
    CONSTRAINT skill_execution_event_event_type_check CHECK ((event_type = ANY (ARRAY['skill.discovered'::text, 'skill.applicability_assessed'::text, 'skill.selected'::text, 'skill.mode_selected'::text, 'skill.context_missing'::text, 'skill.context_resolved'::text, 'skill.composition_started'::text, 'skill.child_selected'::text, 'skill.plan_generated'::text, 'skill.procedure_compiled'::text, 'skill.plan_compliance_passed'::text, 'skill.plan_compliance_failed'::text, 'skill.execution_started'::text, 'skill.execution_waiting_external'::text, 'skill.execution_degraded'::text, 'skill.execution_completed'::text, 'skill.execution_failed'::text, 'skill.hard_gate_triggered'::text, 'skill.human_intervention'::text, 'skill.patch_candidate_created'::text]))),
    CONSTRAINT skill_execution_event_status_after_check CHECK (((status_after IS NULL) OR (status_after = ANY (ARRAY['selected'::text, 'planning'::text, 'executing'::text, 'waiting_external'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'degraded'::text])))),
    CONSTRAINT skill_execution_event_summary_check CHECK (((length(summary) >= 1) AND (length(summary) <= 8192)))
);


--
-- Name: skill_execution_event_sequence_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.skill_execution_event ALTER COLUMN sequence_number ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.skill_execution_event_sequence_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: skill_execution_record; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_execution_record (
    execution_id text NOT NULL,
    parent_execution_id text,
    task_id text NOT NULL,
    goal_id text NOT NULL,
    goal_version integer NOT NULL,
    skill_id text NOT NULL,
    skill_version integer NOT NULL,
    selection_ref text NOT NULL,
    applicability_status text NOT NULL,
    usage_policy_json jsonb NOT NULL,
    workflow_plan_id text NOT NULL,
    workflow_definition_id text NOT NULL,
    workflow_definition_version integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT skill_execution_record_applicability_status_check CHECK ((applicability_status = ANY (ARRAY['satisfied'::text, 'partial'::text, 'unsatisfied'::text, 'unknown'::text]))),
    CONSTRAINT skill_execution_record_goal_version_check CHECK ((goal_version > 0)),
    CONSTRAINT skill_execution_record_selection_ref_check CHECK (((length(selection_ref) >= 1) AND (length(selection_ref) <= 512))),
    CONSTRAINT skill_execution_record_skill_version_check CHECK ((skill_version > 0)),
    CONSTRAINT skill_execution_record_usage_policy_json_check CHECK ((jsonb_typeof(usage_policy_json) = 'object'::text)),
    CONSTRAINT skill_execution_record_workflow_definition_version_check CHECK ((workflow_definition_version > 0))
);


--
-- Name: skill_execution_reference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_execution_reference (
    link_id text NOT NULL,
    execution_id text NOT NULL,
    kind text NOT NULL,
    reference_id text NOT NULL,
    reference_type text NOT NULL,
    source_system text NOT NULL,
    uri text,
    checksum text,
    produced_at timestamp with time zone,
    producer_refs_json jsonb NOT NULL,
    metadata_json jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT skill_execution_reference_checksum_check CHECK (((checksum IS NULL) OR (checksum ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT skill_execution_reference_kind_check CHECK ((kind = ANY (ARRAY['provider'::text, 'resource'::text, 'remote_task_binding'::text, 'evidence'::text, 'hard_gate'::text, 'human_intervention'::text, 'outcome'::text]))),
    CONSTRAINT skill_execution_reference_metadata_json_check CHECK ((jsonb_typeof(metadata_json) = 'object'::text)),
    CONSTRAINT skill_execution_reference_producer_refs_json_check CHECK ((jsonb_typeof(producer_refs_json) = 'array'::text)),
    CONSTRAINT skill_execution_reference_reference_id_check CHECK (((length(reference_id) >= 1) AND (length(reference_id) <= 512))),
    CONSTRAINT skill_execution_reference_reference_type_check CHECK (((length(reference_type) >= 1) AND (length(reference_type) <= 512))),
    CONSTRAINT skill_execution_reference_source_system_check CHECK (((length(source_system) >= 1) AND (length(source_system) <= 512))),
    CONSTRAINT skill_execution_reference_uri_check CHECK (((uri IS NULL) OR ((length(uri) >= 1) AND (length(uri) <= 4096))))
);


--
-- Name: skill_formalization_candidate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_formalization_candidate (
    candidate_id text NOT NULL,
    capability_fingerprint text NOT NULL,
    successful_experience_count integer NOT NULL,
    required_success_threshold integer NOT NULL,
    source_experience_ids_json jsonb NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    induction_report_json jsonb,
    validation_report_json jsonb,
    proposed_skill_json jsonb,
    published_skill_id text,
    published_skill_version integer,
    evaluated_at timestamp with time zone,
    CONSTRAINT skill_formalization_candidate_publication_check CHECK ((((status = 'published'::text) AND (published_skill_id IS NOT NULL) AND (published_skill_version IS NOT NULL)) OR ((status <> 'published'::text) AND (published_skill_id IS NULL) AND (published_skill_version IS NULL)))),
    CONSTRAINT skill_formalization_candidate_required_success_threshold_check CHECK ((required_success_threshold >= 2)),
    CONSTRAINT skill_formalization_candidate_status_check CHECK ((status = ANY (ARRAY['awaiting_simulation'::text, 'validation_failed'::text, 'published'::text]))),
    CONSTRAINT skill_formalization_candidate_successful_experience_count_check CHECK ((successful_experience_count >= 2))
);


--
-- Name: skill_input_resolution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_input_resolution (
    resolution_id text NOT NULL,
    task_id text NOT NULL,
    goal_id text NOT NULL,
    goal_version integer NOT NULL,
    skill_id text NOT NULL,
    skill_version integer NOT NULL,
    structured_input_json jsonb,
    unresolved_fields_json jsonb NOT NULL,
    source_refs_json jsonb NOT NULL,
    decision_summary text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT skill_input_resolution_check CHECK (((status <> 'resolved'::text) OR ((structured_input_json IS NOT NULL) AND (jsonb_array_length(unresolved_fields_json) = 0)))),
    CONSTRAINT skill_input_resolution_check1 CHECK (((status <> 'input_required'::text) OR (jsonb_array_length(unresolved_fields_json) > 0))),
    CONSTRAINT skill_input_resolution_decision_summary_check CHECK ((length(btrim(decision_summary)) > 0)),
    CONSTRAINT skill_input_resolution_goal_version_check CHECK ((goal_version > 0)),
    CONSTRAINT skill_input_resolution_skill_version_check CHECK ((skill_version > 0)),
    CONSTRAINT skill_input_resolution_source_refs_json_check CHECK ((jsonb_typeof(source_refs_json) = 'array'::text)),
    CONSTRAINT skill_input_resolution_status_check CHECK ((status = ANY (ARRAY['resolved'::text, 'input_required'::text, 'failed'::text]))),
    CONSTRAINT skill_input_resolution_unresolved_fields_json_check CHECK ((jsonb_typeof(unresolved_fields_json) = 'array'::text))
);


--
-- Name: skill_package_import_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_package_import_audit (
    skill_id text NOT NULL,
    skill_version integer NOT NULL,
    package_checksum text NOT NULL,
    package_root text NOT NULL,
    file_checksums_json jsonb NOT NULL,
    validated_at timestamp with time zone NOT NULL,
    imported_at timestamp with time zone NOT NULL,
    CONSTRAINT skill_package_import_audit_file_checksums_json_check CHECK ((jsonb_typeof(file_checksums_json) = 'object'::text)),
    CONSTRAINT skill_package_import_audit_package_checksum_check CHECK ((package_checksum ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT skill_package_import_audit_package_root_check CHECK (((length(package_root) >= 1) AND (length(package_root) <= 4096))),
    CONSTRAINT skill_package_import_audit_skill_version_check CHECK ((skill_version > 0))
);


--
-- Name: skill_performance_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_performance_metrics (
    skill_id text NOT NULL,
    sample_count integer NOT NULL,
    success_rate double precision NOT NULL,
    average_duration_ms double precision NOT NULL,
    average_cost double precision NOT NULL,
    failure_count integer NOT NULL,
    stability_score double precision NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT skill_performance_metrics_average_cost_check CHECK ((average_cost >= (0)::double precision)),
    CONSTRAINT skill_performance_metrics_average_duration_ms_check CHECK ((average_duration_ms >= (0)::double precision)),
    CONSTRAINT skill_performance_metrics_failure_count_check CHECK ((failure_count >= 0)),
    CONSTRAINT skill_performance_metrics_sample_count_check CHECK ((sample_count >= 0)),
    CONSTRAINT skill_performance_metrics_stability_score_check CHECK (((stability_score >= (0)::double precision) AND (stability_score <= (1)::double precision))),
    CONSTRAINT skill_performance_metrics_success_rate_check CHECK (((success_rate >= (0)::double precision) AND (success_rate <= (1)::double precision)))
);


--
-- Name: skill_quality_observation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_quality_observation (
    observation_id text NOT NULL,
    skill_id text NOT NULL,
    skill_version integer NOT NULL,
    evaluation_ref text NOT NULL,
    score double precision NOT NULL,
    successful boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT skill_quality_observation_score_check CHECK (((score >= (0)::double precision) AND (score <= (1)::double precision)))
);


--
-- Name: skill_quality_warning; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_quality_warning (
    warning_id text NOT NULL,
    skill_id text NOT NULL,
    skill_version integer NOT NULL,
    kind text NOT NULL,
    observation_ids_json jsonb NOT NULL,
    observed_value double precision NOT NULL,
    threshold double precision NOT NULL,
    summary text NOT NULL,
    status text NOT NULL,
    skill_status_at_creation text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT skill_quality_warning_kind_check CHECK ((kind = ANY (ARRAY['consecutive_low_score'::text, 'failure_rate_increase'::text]))),
    CONSTRAINT skill_quality_warning_status_check CHECK ((status = 'active'::text))
);


--
-- Name: skill_relation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_relation (
    relation_id text NOT NULL,
    source_skill_id text NOT NULL,
    target_skill_id text NOT NULL,
    relation_type text NOT NULL,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT skill_relation_check CHECK ((source_skill_id <> target_skill_id)),
    CONSTRAINT skill_relation_relation_type_check CHECK ((relation_type = ANY (ARRAY['parent_child'::text, 'depends_on'::text, 'input_output_match'::text, 'alternative'::text, 'composition'::text, 'capability_coverage'::text])))
);


--
-- Name: skill_replacement_plan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_replacement_plan (
    replacement_plan_id text NOT NULL,
    selection_id text NOT NULL,
    failed_skill_id text NOT NULL,
    candidates_json jsonb NOT NULL,
    replacement_skill_id text NOT NULL,
    replacement_skill_version integer NOT NULL,
    decision_summary text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    goal_contract_json jsonb NOT NULL,
    CONSTRAINT skill_replacement_plan_status_check CHECK ((status = 'awaiting_confirmation'::text))
);


--
-- Name: skill_selection_record; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_selection_record (
    selection_id text NOT NULL,
    goal_description text NOT NULL,
    candidates_json jsonb NOT NULL,
    selected_skill_id text NOT NULL,
    selected_skill_version integer NOT NULL,
    decision_summary text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    goal_contract_json jsonb NOT NULL
);


--
-- Name: skill_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_version (
    skill_id text NOT NULL,
    version integer NOT NULL,
    name text NOT NULL,
    summary text NOT NULL,
    description text NOT NULL,
    capabilities_json jsonb NOT NULL,
    workflow_guidance text NOT NULL,
    output_instruction text NOT NULL,
    input_schema_json jsonb NOT NULL,
    output_schema_json jsonb NOT NULL,
    tool_policy_json jsonb NOT NULL,
    runtime_policy_json jsonb NOT NULL,
    status text NOT NULL,
    source_kind text NOT NULL,
    validation_passed boolean NOT NULL,
    previous_version integer,
    created_at timestamp with time zone NOT NULL,
    usage_specification_json jsonb,
    CONSTRAINT skill_version_source_kind_check CHECK ((source_kind = ANY (ARRAY['admin'::text, 'a2a_draft'::text, 'experience_evolution'::text, 'manual_correction'::text]))),
    CONSTRAINT skill_version_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'validating'::text, 'enabled'::text, 'disabled'::text, 'deprecated'::text, 'validation_failed'::text]))),
    CONSTRAINT skill_version_usage_specification_json_check CHECK (((usage_specification_json IS NULL) OR (jsonb_typeof(usage_specification_json) = 'object'::text))),
    CONSTRAINT skill_version_version_check CHECK ((version > 0))
);


--
-- Name: stage_model_route; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stage_model_route (
    stage text NOT NULL,
    provider_id text NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT stage_model_route_stage_check CHECK ((stage = ANY (ARRAY['intent'::text, 'goal'::text, 'goal_planning'::text, 'tool_enhancement'::text, 'skill_authoring'::text, 'skill_selection'::text, 'skill_input_resolution'::text, 'workflow_planning'::text, 'execution_decision'::text, 'goal_evaluation'::text, 'evaluation'::text, 'result_processing'::text])))
);


--
-- Name: task_availability_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_availability_snapshot (
    snapshot_id text NOT NULL,
    readiness_id text NOT NULL,
    node_id text NOT NULL,
    server_id text NOT NULL,
    operation_name text NOT NULL,
    arguments_snapshot_json jsonb NOT NULL,
    arguments_hash text NOT NULL,
    timing_snapshot_json jsonb,
    result_json jsonb NOT NULL,
    availability text NOT NULL,
    risk_level text NOT NULL,
    reservation_mode text NOT NULL,
    reservation_ref text,
    valid_until timestamp with time zone,
    source_revision text NOT NULL,
    checked_at timestamp with time zone NOT NULL,
    normalization_reason_codes_json jsonb NOT NULL,
    CONSTRAINT task_availability_snapshot_arguments_hash_check CHECK ((arguments_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT task_availability_snapshot_arguments_snapshot_json_check CHECK ((octet_length((arguments_snapshot_json)::text) <= 1048576)),
    CONSTRAINT task_availability_snapshot_availability_check CHECK ((availability = ANY (ARRAY['available'::text, 'restricted'::text, 'disabled'::text, 'unknown'::text]))),
    CONSTRAINT task_availability_snapshot_check CHECK ((((reservation_mode = 'guaranteed'::text) AND (reservation_ref IS NOT NULL) AND (length(btrim(reservation_ref)) > 0)) OR (reservation_mode <> 'guaranteed'::text))),
    CONSTRAINT task_availability_snapshot_node_id_check CHECK (((length(btrim(node_id)) >= 1) AND (length(btrim(node_id)) <= 256))),
    CONSTRAINT task_availability_snapshot_normalization_reason_codes_jso_check CHECK ((octet_length((normalization_reason_codes_json)::text) <= 1048576)),
    CONSTRAINT task_availability_snapshot_operation_name_check CHECK (((length(btrim(operation_name)) >= 1) AND (length(btrim(operation_name)) <= 512))),
    CONSTRAINT task_availability_snapshot_reservation_mode_check CHECK ((reservation_mode = ANY (ARRAY['none'::text, 'best_effort'::text, 'guaranteed'::text]))),
    CONSTRAINT task_availability_snapshot_result_json_check CHECK ((octet_length((result_json)::text) <= 1048576)),
    CONSTRAINT task_availability_snapshot_risk_level_check CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT task_availability_snapshot_server_id_check CHECK (((length(btrim(server_id)) >= 1) AND (length(btrim(server_id)) <= 256))),
    CONSTRAINT task_availability_snapshot_snapshot_id_check CHECK (((length(btrim(snapshot_id)) >= 1) AND (length(btrim(snapshot_id)) <= 256))),
    CONSTRAINT task_availability_snapshot_source_revision_check CHECK ((length(btrim(source_revision)) > 0)),
    CONSTRAINT task_availability_snapshot_timing_snapshot_json_check CHECK (((timing_snapshot_json IS NULL) OR (octet_length((timing_snapshot_json)::text) <= 1048576)))
);


--
-- Name: task_execution_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_execution_attempt (
    attempt_id text NOT NULL,
    task_id text NOT NULL,
    context_id text NOT NULL,
    reason text NOT NULL,
    status text NOT NULL,
    input_request_id text,
    created_at timestamp with time zone NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_code text,
    CONSTRAINT task_execution_attempt_check CHECK (((reason = 'input_response'::text) = (input_request_id IS NOT NULL))),
    CONSTRAINT task_execution_attempt_check1 CHECK (((status <> 'queued'::text) OR ((started_at IS NULL) AND (completed_at IS NULL)))),
    CONSTRAINT task_execution_attempt_check2 CHECK (((status <> 'running'::text) OR ((started_at IS NOT NULL) AND (completed_at IS NULL)))),
    CONSTRAINT task_execution_attempt_check3 CHECK (((status <> ALL (ARRAY['completed'::text, 'failed'::text])) OR (completed_at IS NOT NULL))),
    CONSTRAINT task_execution_attempt_reason_check CHECK ((reason = ANY (ARRAY['initial'::text, 'input_response'::text]))),
    CONSTRAINT task_execution_attempt_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: task_execution_readiness; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_execution_readiness (
    readiness_id text NOT NULL,
    workflow_plan_id text NOT NULL,
    plan_attempt integer NOT NULL,
    check_phase text NOT NULL,
    workflow_instance_id text,
    workflow_node_run_id text,
    dsl_hash text NOT NULL,
    disposition text NOT NULL,
    permitted_actions_json jsonb NOT NULL,
    model_decision_json jsonb,
    guard_action text NOT NULL,
    guard_reason_codes_json jsonb NOT NULL,
    confirmation_required boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT task_execution_readiness_check CHECK ((((check_phase = 'planning'::text) AND (workflow_instance_id IS NULL) AND (workflow_node_run_id IS NULL)) OR ((check_phase = 'pre_invocation'::text) AND (length(btrim(workflow_instance_id)) > 0) AND (length(btrim(workflow_node_run_id)) > 0)))),
    CONSTRAINT task_execution_readiness_check1 CHECK ((((disposition = 'confirmation_required'::text) AND confirmation_required) OR ((disposition <> 'confirmation_required'::text) AND (NOT confirmation_required)))),
    CONSTRAINT task_execution_readiness_check_phase_check CHECK ((check_phase = ANY (ARRAY['planning'::text, 'pre_invocation'::text]))),
    CONSTRAINT task_execution_readiness_disposition_check CHECK ((disposition = ANY (ARRAY['ready'::text, 'confirmation_required'::text, 'revision_required'::text, 'blocked'::text]))),
    CONSTRAINT task_execution_readiness_dsl_hash_check CHECK ((dsl_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT task_execution_readiness_guard_action_check CHECK ((guard_action = ANY (ARRAY['proceed'::text, 'reschedule'::text, 'revise_dsl'::text, 'request_confirmation'::text, 'abort'::text]))),
    CONSTRAINT task_execution_readiness_guard_reason_codes_json_check CHECK ((octet_length((guard_reason_codes_json)::text) <= 1048576)),
    CONSTRAINT task_execution_readiness_model_decision_json_check CHECK (((model_decision_json IS NULL) OR (octet_length((model_decision_json)::text) <= 1048576))),
    CONSTRAINT task_execution_readiness_permitted_actions_json_check CHECK ((octet_length((permitted_actions_json)::text) <= 1048576)),
    CONSTRAINT task_execution_readiness_plan_attempt_check CHECK ((plan_attempt > 0)),
    CONSTRAINT task_execution_readiness_readiness_id_check CHECK (((length(btrim(readiness_id)) >= 1) AND (length(btrim(readiness_id)) <= 256)))
);


--
-- Name: task_input_request; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_input_request (
    input_request_id text NOT NULL,
    task_id text NOT NULL,
    context_id text NOT NULL,
    source text NOT NULL,
    question text NOT NULL,
    status text NOT NULL,
    control_id text,
    control_round_index integer,
    created_at timestamp with time zone NOT NULL,
    answered_at timestamp with time zone,
    CONSTRAINT task_input_request_check CHECK (((status = 'answered'::text) = (answered_at IS NOT NULL))),
    CONSTRAINT task_input_request_check1 CHECK (((control_id IS NULL) = (control_round_index IS NULL))),
    CONSTRAINT task_input_request_control_round_index_check CHECK (((control_round_index IS NULL) OR (control_round_index >= 0))),
    CONSTRAINT task_input_request_question_check CHECK ((length(btrim(question)) > 0)),
    CONSTRAINT task_input_request_source_check CHECK ((source = ANY (ARRAY['goal_deliberation'::text, 'skill_input_resolution'::text, 'goal_evaluation'::text, 'workflow'::text]))),
    CONSTRAINT task_input_request_status_check CHECK ((status = ANY (ARRAY['waiting'::text, 'answered'::text, 'expired'::text, 'canceled'::text])))
);


--
-- Name: task_input_response; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_input_response (
    input_response_id text NOT NULL,
    input_request_id text NOT NULL,
    task_id text NOT NULL,
    content_json jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: task_quality_report; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_quality_report (
    report_id text NOT NULL,
    task_id text NOT NULL,
    goal_id text NOT NULL,
    goal_version integer NOT NULL,
    workflow_instance_id text NOT NULL,
    processed_result_id text NOT NULL,
    assessments_json jsonb NOT NULL,
    overall_score double precision NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT task_quality_report_goal_version_check CHECK ((goal_version > 0)),
    CONSTRAINT task_quality_report_overall_score_check CHECK (((overall_score >= (0)::double precision) AND (overall_score <= (1)::double precision))),
    CONSTRAINT task_quality_report_status_check CHECK ((status = ANY (ARRAY['passed'::text, 'warning'::text, 'failed'::text])))
);


--
-- Name: task_wait_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_wait_policy (
    singleton boolean DEFAULT true NOT NULL,
    timeout_seconds integer NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT task_wait_policy_singleton_check CHECK (singleton),
    CONSTRAINT task_wait_policy_timeout_seconds_check CHECK ((timeout_seconds > 0))
);


--
-- Name: temporary_skill; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.temporary_skill (
    temporary_skill_id text NOT NULL,
    task_id text NOT NULL,
    context_id text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    tools_json jsonb NOT NULL,
    input_schema_json jsonb NOT NULL,
    output_schema_json jsonb NOT NULL,
    capability_fingerprint text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expired_at timestamp with time zone,
    CONSTRAINT temporary_skill_check CHECK ((((status = 'active'::text) AND (expired_at IS NULL)) OR ((status = 'expired'::text) AND (expired_at IS NOT NULL)))),
    CONSTRAINT temporary_skill_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text])))
);


--
-- Name: temporary_skill_experience; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.temporary_skill_experience (
    experience_id text NOT NULL,
    temporary_skill_id text NOT NULL,
    task_id text NOT NULL,
    context_id text NOT NULL,
    capability_fingerprint text NOT NULL,
    successful boolean NOT NULL,
    outcome_summary text NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: workflow_continuation_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_continuation_attempt (
    attempt_id text NOT NULL,
    event_id text NOT NULL,
    snapshot_id text NOT NULL,
    continuation_id text NOT NULL,
    workflow_instance_id text NOT NULL,
    snapshot_state_version bigint NOT NULL,
    claim_token text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_code text,
    CONSTRAINT workflow_continuation_attempt_attempt_id_check CHECK (((length(btrim(attempt_id)) >= 1) AND (length(btrim(attempt_id)) <= 256))),
    CONSTRAINT workflow_continuation_attempt_check CHECK (((started_at IS NULL) OR (started_at >= created_at))),
    CONSTRAINT workflow_continuation_attempt_check1 CHECK (((completed_at IS NULL) OR ((started_at IS NOT NULL) AND (completed_at >= started_at)) OR ((status = 'stale'::text) AND (completed_at >= created_at)))),
    CONSTRAINT workflow_continuation_attempt_check2 CHECK ((((status = 'claimed'::text) AND (started_at IS NULL) AND (completed_at IS NULL) AND (error_code IS NULL)) OR ((status = 'running'::text) AND (started_at IS NOT NULL) AND (completed_at IS NULL)) OR ((status = ANY (ARRAY['waiting_external'::text, 'succeeded'::text, 'canceled'::text])) AND (started_at IS NOT NULL) AND (completed_at IS NOT NULL) AND (error_code IS NULL)) OR ((status = 'stale'::text) AND (completed_at IS NOT NULL) AND (error_code IS NULL)) OR ((status = 'failed'::text) AND (started_at IS NOT NULL) AND (completed_at IS NOT NULL) AND (length(btrim(error_code)) > 0)))),
    CONSTRAINT workflow_continuation_attempt_claim_token_check CHECK (((length(btrim(claim_token)) >= 1) AND (length(btrim(claim_token)) <= 256))),
    CONSTRAINT workflow_continuation_attempt_continuation_id_check CHECK (((length(btrim(continuation_id)) >= 1) AND (length(btrim(continuation_id)) <= 256))),
    CONSTRAINT workflow_continuation_attempt_snapshot_state_version_check CHECK ((snapshot_state_version > 0)),
    CONSTRAINT workflow_continuation_attempt_status_check CHECK ((status = ANY (ARRAY['claimed'::text, 'running'::text, 'waiting_external'::text, 'succeeded'::text, 'failed'::text, 'canceled'::text, 'stale'::text])))
);


--
-- Name: workflow_continuation_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_continuation_snapshot (
    snapshot_id text NOT NULL,
    continuation_id text NOT NULL,
    state_version bigint NOT NULL,
    predecessor_snapshot_id text,
    schema_version text NOT NULL,
    lifecycle text NOT NULL,
    agent_task_id text NOT NULL,
    context_id text NOT NULL,
    workflow_control_id text NOT NULL,
    goal_id text NOT NULL,
    goal_version integer NOT NULL,
    workflow_plan_id text NOT NULL,
    workflow_definition_id text NOT NULL,
    workflow_definition_version integer NOT NULL,
    workflow_definition_hash text NOT NULL,
    input_hash text NOT NULL,
    workflow_instance_id text NOT NULL,
    state_json jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT workflow_continuation_snapsho_workflow_definition_version_check CHECK ((workflow_definition_version > 0)),
    CONSTRAINT workflow_continuation_snapshot_check CHECK ((updated_at >= created_at)),
    CONSTRAINT workflow_continuation_snapshot_check1 CHECK ((((state_version = 1) AND (predecessor_snapshot_id IS NULL)) OR ((state_version > 1) AND (predecessor_snapshot_id IS NOT NULL)))),
    CONSTRAINT workflow_continuation_snapshot_continuation_id_check CHECK (((length(btrim(continuation_id)) >= 1) AND (length(btrim(continuation_id)) <= 256))),
    CONSTRAINT workflow_continuation_snapshot_goal_version_check CHECK ((goal_version > 0)),
    CONSTRAINT workflow_continuation_snapshot_input_hash_check CHECK ((input_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT workflow_continuation_snapshot_lifecycle_check CHECK ((lifecycle = ANY (ARRAY['building'::text, 'active'::text, 'superseded'::text, 'invalidated'::text, 'terminal'::text]))),
    CONSTRAINT workflow_continuation_snapshot_schema_version_check CHECK ((schema_version = '1.0'::text)),
    CONSTRAINT workflow_continuation_snapshot_snapshot_id_check CHECK (((length(btrim(snapshot_id)) >= 1) AND (length(btrim(snapshot_id)) <= 256))),
    CONSTRAINT workflow_continuation_snapshot_state_json_check CHECK ((octet_length((state_json)::text) <= 1048576)),
    CONSTRAINT workflow_continuation_snapshot_state_version_check CHECK ((state_version > 0)),
    CONSTRAINT workflow_continuation_snapshot_workflow_definition_hash_check CHECK ((workflow_definition_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT workflow_continuation_snapshot_workflow_definition_id_check CHECK ((length(btrim(workflow_definition_id)) > 0))
);


--
-- Name: workflow_continuation_wait_binding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_continuation_wait_binding (
    snapshot_id text NOT NULL,
    wait_id text NOT NULL,
    binding_id text NOT NULL,
    wait_kind text NOT NULL,
    node_id text NOT NULL,
    node_run_id text NOT NULL,
    wait_state text NOT NULL,
    CONSTRAINT workflow_continuation_wait_binding_node_id_check CHECK (((length(btrim(node_id)) >= 1) AND (length(btrim(node_id)) <= 256))),
    CONSTRAINT workflow_continuation_wait_binding_node_run_id_check CHECK (((length(btrim(node_run_id)) >= 1) AND (length(btrim(node_run_id)) <= 1024))),
    CONSTRAINT workflow_continuation_wait_binding_wait_id_check CHECK (((length(btrim(wait_id)) >= 1) AND (length(btrim(wait_id)) <= 256))),
    CONSTRAINT workflow_continuation_wait_binding_wait_kind_check CHECK ((wait_kind = 'remote_task'::text)),
    CONSTRAINT workflow_continuation_wait_binding_wait_state_check CHECK ((wait_state = ANY (ARRAY['waiting'::text, 'awaiting_input'::text])))
);


--
-- Name: workflow_control; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_control (
    control_id text NOT NULL,
    context_id text NOT NULL,
    goal_id text NOT NULL,
    goal_version integer NOT NULL,
    task_id text,
    status text NOT NULL,
    current_plan_id text NOT NULL,
    input_json jsonb NOT NULL,
    skill_ids_json jsonb NOT NULL,
    planning_instruction text NOT NULL,
    round_count integer NOT NULL,
    replan_count integer NOT NULL,
    final_instance_id text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    terminal_outcome_id text,
    CONSTRAINT workflow_control_goal_version_check CHECK ((goal_version > 0)),
    CONSTRAINT workflow_control_replan_count_check CHECK ((replan_count >= 0)),
    CONSTRAINT workflow_control_round_count_check CHECK ((round_count >= 0)),
    CONSTRAINT workflow_control_status_check CHECK ((status = ANY (ARRAY['running'::text, 'awaiting_confirmation'::text, 'awaiting_input'::text, 'capability_gap'::text, 'achieved'::text, 'unachievable'::text, 'canceled'::text, 'failed'::text, 'replan_budget_exhausted'::text])))
);


--
-- Name: workflow_control_round; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_control_round (
    control_id text NOT NULL,
    round_index integer NOT NULL,
    plan_id text NOT NULL,
    instance_id text NOT NULL,
    workflow_version integer NOT NULL,
    evaluation_decision text NOT NULL,
    evaluation_summary text NOT NULL,
    replan_instruction text,
    evaluation_detail_json jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    terminal_outcome_id text,
    CONSTRAINT workflow_control_round_evaluation_decision_check CHECK ((evaluation_decision = ANY (ARRAY['achieved'::text, 'request_input'::text, 'adjust_plan'::text, 'replace_skill'::text, 'invoke_additional_skill'::text, 'capability_gap'::text, 'unachievable'::text]))),
    CONSTRAINT workflow_control_round_round_index_check CHECK ((round_index >= 0)),
    CONSTRAINT workflow_control_round_workflow_version_check CHECK ((workflow_version > 0))
);


--
-- Name: workflow_instance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_instance (
    instance_id text NOT NULL,
    plan_id text NOT NULL,
    workflow_definition_id text NOT NULL,
    workflow_version integer NOT NULL,
    goal_id text NOT NULL,
    goal_version integer NOT NULL,
    status text NOT NULL,
    input_json jsonb NOT NULL,
    result_json jsonb,
    errors_json jsonb NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    skill_versions_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    budget_limits_json jsonb DEFAULT '{"maxCost": 100, "maxReplans": 3, "maxLlmCalls": 20, "maxMcpCalls": 20, "maxDurationSeconds": 300}'::jsonb NOT NULL,
    budget_usage_json jsonb DEFAULT '{"cost": 0, "llmCalls": 0, "mcpCalls": 0, "durationMs": 0, "replanCount": 0}'::jsonb NOT NULL,
    termination_reason text,
    pending_confirmation_json jsonb,
    CONSTRAINT workflow_instance_goal_version_check CHECK ((goal_version > 0)),
    CONSTRAINT workflow_instance_status_check CHECK ((status = ANY (ARRAY['running'::text, 'paused'::text, 'waiting_external'::text, 'succeeded'::text, 'failed'::text, 'canceled'::text, 'invalidated'::text]))),
    CONSTRAINT workflow_instance_termination_reason_check CHECK (((termination_reason IS NULL) OR (termination_reason = ANY (ARRAY['duration_exhausted'::text, 'llm_calls_exhausted'::text, 'mcp_calls_exhausted'::text, 'cost_exhausted'::text, 'replans_exhausted'::text])))),
    CONSTRAINT workflow_instance_workflow_version_check CHECK ((workflow_version > 0))
);


--
-- Name: workflow_node_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_node_event (
    event_id text NOT NULL,
    instance_id text NOT NULL,
    sequence integer NOT NULL,
    node_id text NOT NULL,
    event_type text NOT NULL,
    event_timestamp timestamp with time zone NOT NULL,
    summary text NOT NULL,
    duration_ms integer,
    CONSTRAINT workflow_node_event_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT workflow_node_event_event_type_check CHECK ((event_type = ANY (ARRAY['node_started'::text, 'node_succeeded'::text, 'node_failed'::text, 'node_waiting_external'::text]))),
    CONSTRAINT workflow_node_event_sequence_check CHECK ((sequence > 0))
);


--
-- Name: workflow_plan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_plan (
    plan_id text NOT NULL,
    goal_id text NOT NULL,
    goal_version integer NOT NULL,
    definition_json jsonb,
    source_confirmed_plan_id text,
    confirmation_status text NOT NULL,
    attempt_count integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    source_plan_id text,
    revision_kind text,
    confirmation_task_id text,
    confirmed_at timestamp with time zone,
    mcp_protocol_contract_json jsonb DEFAULT '{"mode": "frozen_v1", "baselineSha256": "9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708", "protocolVersion": "2026-07-28"}'::jsonb NOT NULL,
    composition_context_json jsonb,
    capability_gap_skill_ids_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    tool_execution_semantics_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    goal_contract_json jsonb NOT NULL,
    CONSTRAINT workflow_plan_attempt_count_check CHECK ((attempt_count > 0)),
    CONSTRAINT workflow_plan_capability_gap_array_check CHECK ((jsonb_typeof(capability_gap_skill_ids_json) = 'array'::text)),
    CONSTRAINT workflow_plan_composition_context_object_check CHECK (((composition_context_json IS NULL) OR (jsonb_typeof(composition_context_json) = 'object'::text))),
    CONSTRAINT workflow_plan_confirmation_status_check CHECK ((confirmation_status = ANY (ARRAY['awaiting_confirmation'::text, 'confirmed'::text, 'failed'::text, 'superseded'::text, 'invalidated'::text]))),
    CONSTRAINT workflow_plan_goal_contract_identity_check CHECK ((((goal_contract_json ->> 'goalId'::text) = goal_id) AND (((goal_contract_json ->> 'version'::text))::integer = goal_version))),
    CONSTRAINT workflow_plan_mcp_protocol_contract_json_check CHECK ((jsonb_typeof(mcp_protocol_contract_json) = 'object'::text)),
    CONSTRAINT workflow_plan_revision_kind_check CHECK (((revision_kind IS NULL) OR (revision_kind = ANY (ARRAY['auto_correction'::text, 'natural_language'::text, 'admin_dsl'::text, 'admin_dag'::text, 'replan'::text])))),
    CONSTRAINT workflow_plan_tool_execution_semantics_array_check CHECK ((jsonb_typeof(tool_execution_semantics_json) = 'array'::text))
);


--
-- Name: workflow_plan_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_plan_attempt (
    plan_id text NOT NULL,
    attempt integer NOT NULL,
    candidate_json jsonb NOT NULL,
    validation_errors_json jsonb NOT NULL,
    valid boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    mcp_protocol_contract_json jsonb DEFAULT '{"mode": "frozen_v1", "baselineSha256": "9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708", "protocolVersion": "2026-07-28"}'::jsonb NOT NULL,
    composition_context_json jsonb,
    capability_gap_skill_ids_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    tool_execution_semantics_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    goal_contract_json jsonb NOT NULL,
    CONSTRAINT workflow_plan_attempt_attempt_check CHECK ((attempt > 0)),
    CONSTRAINT workflow_plan_attempt_capability_gap_array_check CHECK ((jsonb_typeof(capability_gap_skill_ids_json) = 'array'::text)),
    CONSTRAINT workflow_plan_attempt_composition_context_object_check CHECK (((composition_context_json IS NULL) OR (jsonb_typeof(composition_context_json) = 'object'::text))),
    CONSTRAINT workflow_plan_attempt_mcp_protocol_contract_json_check CHECK ((jsonb_typeof(mcp_protocol_contract_json) = 'object'::text)),
    CONSTRAINT workflow_plan_attempt_tool_execution_semantics_array_check CHECK ((jsonb_typeof(tool_execution_semantics_json) = 'array'::text))
);


--
-- Name: workflow_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_template (
    template_id text NOT NULL,
    version integer NOT NULL,
    goal_key text NOT NULL,
    structure_key text NOT NULL,
    workflow_json jsonb NOT NULL,
    source_experience_ids_json jsonb NOT NULL,
    source_success_count integer NOT NULL,
    use_count integer NOT NULL,
    successful_use_count integer NOT NULL,
    average_use_duration_ms double precision NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT workflow_template_average_use_duration_ms_check CHECK ((average_use_duration_ms >= (0)::double precision)),
    CONSTRAINT workflow_template_check CHECK (((successful_use_count >= 0) AND (successful_use_count <= use_count))),
    CONSTRAINT workflow_template_source_success_count_check CHECK ((source_success_count >= 3)),
    CONSTRAINT workflow_template_status_check CHECK ((status = 'enabled'::text)),
    CONSTRAINT workflow_template_use_count_check CHECK ((use_count >= 0)),
    CONSTRAINT workflow_template_version_check CHECK ((version > 0))
);


--
-- Name: workflow_template_occurrence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_template_occurrence (
    experience_id text NOT NULL,
    goal_key text NOT NULL,
    structure_key text NOT NULL,
    workflow_json jsonb NOT NULL,
    duration_ms double precision NOT NULL,
    created_at timestamp with time zone NOT NULL,
    quality_report_id text,
    CONSTRAINT workflow_template_occurrence_duration_ms_check CHECK ((duration_ms >= (0)::double precision))
);


--
-- Name: workflow_template_use; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_template_use (
    use_id text NOT NULL,
    template_id text NOT NULL,
    template_version integer NOT NULL,
    plan_id text NOT NULL,
    workflow_definition_id text NOT NULL,
    workflow_version integer NOT NULL,
    status text NOT NULL,
    duration_ms double precision,
    created_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT workflow_template_use_duration_ms_check CHECK ((duration_ms >= (0)::double precision)),
    CONSTRAINT workflow_template_use_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'succeeded'::text, 'failed'::text])))
);


--
-- Name: agent_task agent_task_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_task
    ADD CONSTRAINT agent_task_pkey PRIMARY KEY (task_id);


--
-- Name: conversation_context conversation_context_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_context
    ADD CONSTRAINT conversation_context_pkey PRIMARY KEY (context_id);


--
-- Name: evaluation_influence evaluation_influence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_influence
    ADD CONSTRAINT evaluation_influence_pkey PRIMARY KEY (influence_id);


--
-- Name: evaluation_influence evaluation_influence_report_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_influence
    ADD CONSTRAINT evaluation_influence_report_id_key UNIQUE (report_id);


--
-- Name: evolution_experience evolution_experience_control_id_round_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_experience
    ADD CONSTRAINT evolution_experience_control_id_round_index_key UNIQUE (control_id, round_index);


--
-- Name: evolution_experience evolution_experience_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_experience
    ADD CONSTRAINT evolution_experience_pkey PRIMARY KEY (experience_id);


--
-- Name: evolution_policy evolution_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_policy
    ADD CONSTRAINT evolution_policy_pkey PRIMARY KEY (singleton);


--
-- Name: evolution_trigger evolution_trigger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_trigger
    ADD CONSTRAINT evolution_trigger_pkey PRIMARY KEY (trigger_id);


--
-- Name: external_task_projection external_task_projection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_task_projection
    ADD CONSTRAINT external_task_projection_pkey PRIMARY KEY (protocol, task_id);


--
-- Name: goal_cancellation goal_cancellation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_cancellation
    ADD CONSTRAINT goal_cancellation_pkey PRIMARY KEY (cancellation_id);


--
-- Name: goal goal_goal_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal
    ADD CONSTRAINT goal_goal_id_version_key UNIQUE (goal_id, version);


--
-- Name: goal_input_inference goal_input_inference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_input_inference
    ADD CONSTRAINT goal_input_inference_pkey PRIMARY KEY (inference_id);


--
-- Name: goal_patch goal_patch_goal_id_to_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_patch
    ADD CONSTRAINT goal_patch_goal_id_to_version_key UNIQUE (goal_id, to_version);


--
-- Name: goal_patch goal_patch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_patch
    ADD CONSTRAINT goal_patch_pkey PRIMARY KEY (patch_id);


--
-- Name: goal goal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal
    ADD CONSTRAINT goal_pkey PRIMARY KEY (goal_id);


--
-- Name: goal_transition goal_transition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_transition
    ADD CONSTRAINT goal_transition_pkey PRIMARY KEY (transition_id);


--
-- Name: goal_transition goal_transition_to_goal_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_transition
    ADD CONSTRAINT goal_transition_to_goal_id_key UNIQUE (to_goal_id);


--
-- Name: implicit_feedback implicit_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.implicit_feedback
    ADD CONSTRAINT implicit_feedback_pkey PRIMARY KEY (feedback_id);


--
-- Name: mcp_dependency_warning mcp_dependency_warning_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_dependency_warning
    ADD CONSTRAINT mcp_dependency_warning_pkey PRIMARY KEY (warning_id);


--
-- Name: mcp_dependency_warning mcp_dependency_warning_server_id_tool_name_reason_skill_id__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_dependency_warning
    ADD CONSTRAINT mcp_dependency_warning_server_id_tool_name_reason_skill_id__key UNIQUE (server_id, tool_name, reason, skill_id, skill_version, tool_revision);


--
-- Name: mcp_invocation mcp_invocation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_invocation
    ADD CONSTRAINT mcp_invocation_pkey PRIMARY KEY (invocation_id);


--
-- Name: mcp_management_operation mcp_management_operation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_management_operation
    ADD CONSTRAINT mcp_management_operation_pkey PRIMARY KEY (operation_id);


--
-- Name: mcp_protocol_snapshot mcp_protocol_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_protocol_snapshot
    ADD CONSTRAINT mcp_protocol_snapshot_pkey PRIMARY KEY (snapshot_id);


--
-- Name: mcp_protocol_snapshot mcp_protocol_snapshot_server_id_tool_revision_protocol_mode_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_protocol_snapshot
    ADD CONSTRAINT mcp_protocol_snapshot_server_id_tool_revision_protocol_mode_key UNIQUE (server_id, tool_revision, protocol_mode);


--
-- Name: mcp_server mcp_server_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_server
    ADD CONSTRAINT mcp_server_pkey PRIMARY KEY (server_id);


--
-- Name: mcp_tool mcp_tool_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_tool
    ADD CONSTRAINT mcp_tool_pkey PRIMARY KEY (server_id, tool_name);


--
-- Name: memory_item memory_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_item
    ADD CONSTRAINT memory_item_pkey PRIMARY KEY (memory_id);


--
-- Name: memory_retention_policy memory_retention_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_retention_policy
    ADD CONSTRAINT memory_retention_policy_pkey PRIMARY KEY (singleton);


--
-- Name: memory_status_transition memory_status_transition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_status_transition
    ADD CONSTRAINT memory_status_transition_pkey PRIMARY KEY (transition_id);


--
-- Name: model_invocation model_invocation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_invocation
    ADD CONSTRAINT model_invocation_pkey PRIMARY KEY (invocation_id);


--
-- Name: model_provider model_provider_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_provider
    ADD CONSTRAINT model_provider_pkey PRIMARY KEY (provider_id);


--
-- Name: processed_result processed_result_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_result
    ADD CONSTRAINT processed_result_pkey PRIMARY KEY (result_id);


--
-- Name: prompt prompt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt
    ADD CONSTRAINT prompt_pkey PRIMARY KEY (prompt_id);


--
-- Name: prompt prompt_stage_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt
    ADD CONSTRAINT prompt_stage_key UNIQUE (stage);


--
-- Name: prompt_version prompt_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_version
    ADD CONSTRAINT prompt_version_pkey PRIMARY KEY (prompt_id, version);


--
-- Name: remote_task_binding remote_task_binding_input_authority_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_binding
    ADD CONSTRAINT remote_task_binding_input_authority_unique UNIQUE (binding_id, remote_task_id, workflow_instance_id, workflow_node_id, workflow_node_run_id);


--
-- Name: remote_task_binding remote_task_binding_mcp_invocation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_binding
    ADD CONSTRAINT remote_task_binding_mcp_invocation_id_key UNIQUE (mcp_invocation_id);


--
-- Name: remote_task_binding remote_task_binding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_binding
    ADD CONSTRAINT remote_task_binding_pkey PRIMARY KEY (binding_id);


--
-- Name: remote_task_binding remote_task_binding_server_id_remote_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_binding
    ADD CONSTRAINT remote_task_binding_server_id_remote_task_id_key UNIQUE (server_id, remote_task_id);


--
-- Name: remote_task_binding remote_task_binding_workflow_instance_id_workflow_node_run__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_binding
    ADD CONSTRAINT remote_task_binding_workflow_instance_id_workflow_node_run__key UNIQUE (workflow_instance_id, workflow_node_run_id);


--
-- Name: remote_task_cancel_attempt remote_task_cancel_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_cancel_attempt
    ADD CONSTRAINT remote_task_cancel_attempt_pkey PRIMARY KEY (attempt_id);


--
-- Name: remote_task_cancel_request remote_task_cancel_request_binding_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_cancel_request
    ADD CONSTRAINT remote_task_cancel_request_binding_id_idempotency_key_key UNIQUE (binding_id, idempotency_key);


--
-- Name: remote_task_cancel_request remote_task_cancel_request_cancel_request_id_binding_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_cancel_request
    ADD CONSTRAINT remote_task_cancel_request_cancel_request_id_binding_id_key UNIQUE (cancel_request_id, binding_id);


--
-- Name: remote_task_cancel_request remote_task_cancel_request_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_cancel_request
    ADD CONSTRAINT remote_task_cancel_request_pkey PRIMARY KEY (cancel_request_id);


--
-- Name: remote_task_control_event remote_task_control_event_binding_id_event_type_remote_revi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_control_event
    ADD CONSTRAINT remote_task_control_event_binding_id_event_type_remote_revi_key UNIQUE (binding_id, event_type, remote_revision, result_hash);


--
-- Name: remote_task_control_event remote_task_control_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_control_event
    ADD CONSTRAINT remote_task_control_event_pkey PRIMARY KEY (event_id);


--
-- Name: remote_task_input_attempt remote_task_input_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_input_attempt
    ADD CONSTRAINT remote_task_input_attempt_pkey PRIMARY KEY (attempt_id);


--
-- Name: remote_task_input_link remote_task_input_link_binding_id_remote_revision_result_ha_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_input_link
    ADD CONSTRAINT remote_task_input_link_binding_id_remote_revision_result_ha_key UNIQUE (binding_id, remote_revision, result_hash);


--
-- Name: remote_task_input_link remote_task_input_link_control_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_input_link
    ADD CONSTRAINT remote_task_input_link_control_event_id_key UNIQUE (control_event_id);


--
-- Name: remote_task_input_link remote_task_input_link_input_request_id_binding_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_input_link
    ADD CONSTRAINT remote_task_input_link_input_request_id_binding_id_key UNIQUE (input_request_id, binding_id);


--
-- Name: remote_task_input_link remote_task_input_link_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_input_link
    ADD CONSTRAINT remote_task_input_link_pkey PRIMARY KEY (input_request_id);


--
-- Name: remote_task_observation remote_task_observation_binding_id_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_observation
    ADD CONSTRAINT remote_task_observation_binding_id_sequence_key UNIQUE (binding_id, sequence);


--
-- Name: remote_task_observation remote_task_observation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_observation
    ADD CONSTRAINT remote_task_observation_pkey PRIMARY KEY (observation_id);


--
-- Name: remote_task_protocol_attempt remote_task_protocol_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_protocol_attempt
    ADD CONSTRAINT remote_task_protocol_attempt_pkey PRIMARY KEY (attempt_id);


--
-- Name: runtime_bootstrap_probe runtime_bootstrap_probe_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_bootstrap_probe
    ADD CONSTRAINT runtime_bootstrap_probe_label_key UNIQUE (label);


--
-- Name: runtime_bootstrap_probe runtime_bootstrap_probe_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_bootstrap_probe
    ADD CONSTRAINT runtime_bootstrap_probe_pkey PRIMARY KEY (id);


--
-- Name: runtime_event runtime_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_event
    ADD CONSTRAINT runtime_event_pkey PRIMARY KEY (event_id);


--
-- Name: runtime_terminal_outcome runtime_terminal_outcome_control_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_terminal_outcome
    ADD CONSTRAINT runtime_terminal_outcome_control_id_key UNIQUE (control_id);


--
-- Name: runtime_terminal_outcome runtime_terminal_outcome_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_terminal_outcome
    ADD CONSTRAINT runtime_terminal_outcome_pkey PRIMARY KEY (outcome_id);


--
-- Name: runtime_terminal_outcome runtime_terminal_outcome_result_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_terminal_outcome
    ADD CONSTRAINT runtime_terminal_outcome_result_id_key UNIQUE (result_id);


--
-- Name: schema_migration schema_migration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migration
    ADD CONSTRAINT schema_migration_pkey PRIMARY KEY (version);


--
-- Name: skill_call_workflow skill_call_workflow_child_instance_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_call_workflow
    ADD CONSTRAINT skill_call_workflow_child_instance_id_key UNIQUE (child_instance_id);


--
-- Name: skill_call_workflow skill_call_workflow_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_call_workflow
    ADD CONSTRAINT skill_call_workflow_pkey PRIMARY KEY (call_id);


--
-- Name: skill_draft skill_draft_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_draft
    ADD CONSTRAINT skill_draft_pkey PRIMARY KEY (draft_id);


--
-- Name: skill_embedding skill_embedding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_embedding
    ADD CONSTRAINT skill_embedding_pkey PRIMARY KEY (skill_id);


--
-- Name: skill_evolution_correction_experience skill_evolution_correction_experience_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_evolution_correction_experience
    ADD CONSTRAINT skill_evolution_correction_experience_pkey PRIMARY KEY (correction_id);


--
-- Name: skill_execution_event skill_execution_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_event
    ADD CONSTRAINT skill_execution_event_pkey PRIMARY KEY (event_id);


--
-- Name: skill_execution_record skill_execution_record_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_record
    ADD CONSTRAINT skill_execution_record_pkey PRIMARY KEY (execution_id);


--
-- Name: skill_execution_record skill_execution_record_task_id_workflow_plan_id_skill_id_sk_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_record
    ADD CONSTRAINT skill_execution_record_task_id_workflow_plan_id_skill_id_sk_key UNIQUE (task_id, workflow_plan_id, skill_id, skill_version);


--
-- Name: skill_execution_reference skill_execution_reference_execution_id_kind_reference_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_reference
    ADD CONSTRAINT skill_execution_reference_execution_id_kind_reference_id_key UNIQUE (execution_id, kind, reference_id);


--
-- Name: skill_execution_reference skill_execution_reference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_reference
    ADD CONSTRAINT skill_execution_reference_pkey PRIMARY KEY (link_id);


--
-- Name: skill_formalization_candidate skill_formalization_candidate_capability_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_formalization_candidate
    ADD CONSTRAINT skill_formalization_candidate_capability_fingerprint_key UNIQUE (capability_fingerprint);


--
-- Name: skill_formalization_candidate skill_formalization_candidate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_formalization_candidate
    ADD CONSTRAINT skill_formalization_candidate_pkey PRIMARY KEY (candidate_id);


--
-- Name: skill_input_resolution skill_input_resolution_identity_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_input_resolution
    ADD CONSTRAINT skill_input_resolution_identity_unique UNIQUE (resolution_id, task_id, goal_version, skill_id, skill_version);


--
-- Name: skill_input_resolution skill_input_resolution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_input_resolution
    ADD CONSTRAINT skill_input_resolution_pkey PRIMARY KEY (resolution_id);


--
-- Name: skill_package_import_audit skill_package_import_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_package_import_audit
    ADD CONSTRAINT skill_package_import_audit_pkey PRIMARY KEY (skill_id, skill_version);


--
-- Name: skill_performance_metrics skill_performance_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_performance_metrics
    ADD CONSTRAINT skill_performance_metrics_pkey PRIMARY KEY (skill_id);


--
-- Name: skill skill_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill
    ADD CONSTRAINT skill_pkey PRIMARY KEY (skill_id);


--
-- Name: skill_quality_observation skill_quality_observation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_quality_observation
    ADD CONSTRAINT skill_quality_observation_pkey PRIMARY KEY (observation_id);


--
-- Name: skill_quality_warning skill_quality_warning_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_quality_warning
    ADD CONSTRAINT skill_quality_warning_pkey PRIMARY KEY (warning_id);


--
-- Name: skill_quality_warning skill_quality_warning_skill_id_skill_version_kind_status_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_quality_warning
    ADD CONSTRAINT skill_quality_warning_skill_id_skill_version_kind_status_key UNIQUE (skill_id, skill_version, kind, status);


--
-- Name: skill_relation skill_relation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_relation
    ADD CONSTRAINT skill_relation_pkey PRIMARY KEY (relation_id);


--
-- Name: skill_relation skill_relation_source_skill_id_target_skill_id_relation_typ_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_relation
    ADD CONSTRAINT skill_relation_source_skill_id_target_skill_id_relation_typ_key UNIQUE (source_skill_id, target_skill_id, relation_type);


--
-- Name: skill_replacement_plan skill_replacement_plan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_replacement_plan
    ADD CONSTRAINT skill_replacement_plan_pkey PRIMARY KEY (replacement_plan_id);


--
-- Name: skill_selection_record skill_selection_record_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_selection_record
    ADD CONSTRAINT skill_selection_record_pkey PRIMARY KEY (selection_id);


--
-- Name: skill_version skill_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_version
    ADD CONSTRAINT skill_version_pkey PRIMARY KEY (skill_id, version);


--
-- Name: stage_model_route stage_model_route_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_model_route
    ADD CONSTRAINT stage_model_route_pkey PRIMARY KEY (stage);


--
-- Name: task_availability_snapshot task_availability_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_availability_snapshot
    ADD CONSTRAINT task_availability_snapshot_pkey PRIMARY KEY (snapshot_id);


--
-- Name: task_availability_snapshot task_availability_snapshot_readiness_id_node_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_availability_snapshot
    ADD CONSTRAINT task_availability_snapshot_readiness_id_node_id_key UNIQUE (readiness_id, node_id);


--
-- Name: task_execution_attempt task_execution_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_execution_attempt
    ADD CONSTRAINT task_execution_attempt_pkey PRIMARY KEY (attempt_id);


--
-- Name: task_execution_readiness task_execution_readiness_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_execution_readiness
    ADD CONSTRAINT task_execution_readiness_pkey PRIMARY KEY (readiness_id);


--
-- Name: task_input_request task_input_request_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_input_request
    ADD CONSTRAINT task_input_request_pkey PRIMARY KEY (input_request_id);


--
-- Name: task_input_response task_input_response_input_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_input_response
    ADD CONSTRAINT task_input_response_input_request_id_key UNIQUE (input_request_id);


--
-- Name: task_input_response task_input_response_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_input_response
    ADD CONSTRAINT task_input_response_pkey PRIMARY KEY (input_response_id);


--
-- Name: task_quality_report task_quality_report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_quality_report
    ADD CONSTRAINT task_quality_report_pkey PRIMARY KEY (report_id);


--
-- Name: task_quality_report task_quality_report_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_quality_report
    ADD CONSTRAINT task_quality_report_task_id_key UNIQUE (task_id);


--
-- Name: task_wait_policy task_wait_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_wait_policy
    ADD CONSTRAINT task_wait_policy_pkey PRIMARY KEY (singleton);


--
-- Name: temporary_skill_experience temporary_skill_experience_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.temporary_skill_experience
    ADD CONSTRAINT temporary_skill_experience_pkey PRIMARY KEY (experience_id);


--
-- Name: temporary_skill temporary_skill_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.temporary_skill
    ADD CONSTRAINT temporary_skill_pkey PRIMARY KEY (temporary_skill_id);


--
-- Name: workflow_continuation_attempt workflow_continuation_attempt_claim_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_attempt
    ADD CONSTRAINT workflow_continuation_attempt_claim_token_key UNIQUE (claim_token);


--
-- Name: workflow_continuation_attempt workflow_continuation_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_attempt
    ADD CONSTRAINT workflow_continuation_attempt_pkey PRIMARY KEY (attempt_id);


--
-- Name: workflow_continuation_snapshot workflow_continuation_snapsho_continuation_id_state_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_snapshot
    ADD CONSTRAINT workflow_continuation_snapsho_continuation_id_state_version_key UNIQUE (continuation_id, state_version);


--
-- Name: workflow_continuation_snapshot workflow_continuation_snapsho_snapshot_id_continuation_id_s_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_snapshot
    ADD CONSTRAINT workflow_continuation_snapsho_snapshot_id_continuation_id_s_key UNIQUE (snapshot_id, continuation_id, state_version);


--
-- Name: workflow_continuation_snapshot workflow_continuation_snapsho_workflow_instance_id_state_ve_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_snapshot
    ADD CONSTRAINT workflow_continuation_snapsho_workflow_instance_id_state_ve_key UNIQUE (workflow_instance_id, state_version);


--
-- Name: workflow_continuation_snapshot workflow_continuation_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_snapshot
    ADD CONSTRAINT workflow_continuation_snapshot_pkey PRIMARY KEY (snapshot_id);


--
-- Name: workflow_continuation_wait_binding workflow_continuation_wait_binding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_wait_binding
    ADD CONSTRAINT workflow_continuation_wait_binding_pkey PRIMARY KEY (snapshot_id, wait_id);


--
-- Name: workflow_continuation_wait_binding workflow_continuation_wait_binding_snapshot_id_binding_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_wait_binding
    ADD CONSTRAINT workflow_continuation_wait_binding_snapshot_id_binding_id_key UNIQUE (snapshot_id, binding_id);


--
-- Name: workflow_continuation_wait_binding workflow_continuation_wait_binding_snapshot_id_node_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_wait_binding
    ADD CONSTRAINT workflow_continuation_wait_binding_snapshot_id_node_run_id_key UNIQUE (snapshot_id, node_run_id);


--
-- Name: workflow_control workflow_control_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control
    ADD CONSTRAINT workflow_control_pkey PRIMARY KEY (control_id);


--
-- Name: workflow_control_round workflow_control_round_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control_round
    ADD CONSTRAINT workflow_control_round_pkey PRIMARY KEY (control_id, round_index);


--
-- Name: workflow_control_round workflow_control_round_terminal_outcome_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control_round
    ADD CONSTRAINT workflow_control_round_terminal_outcome_id_key UNIQUE (terminal_outcome_id);


--
-- Name: workflow_control workflow_control_terminal_outcome_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control
    ADD CONSTRAINT workflow_control_terminal_outcome_id_key UNIQUE (terminal_outcome_id);


--
-- Name: workflow_instance workflow_instance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instance
    ADD CONSTRAINT workflow_instance_pkey PRIMARY KEY (instance_id);


--
-- Name: workflow_node_event workflow_node_event_instance_id_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_node_event
    ADD CONSTRAINT workflow_node_event_instance_id_sequence_key UNIQUE (instance_id, sequence);


--
-- Name: workflow_node_event workflow_node_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_node_event
    ADD CONSTRAINT workflow_node_event_pkey PRIMARY KEY (event_id);


--
-- Name: workflow_plan_attempt workflow_plan_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_plan_attempt
    ADD CONSTRAINT workflow_plan_attempt_pkey PRIMARY KEY (plan_id, attempt);


--
-- Name: workflow_plan workflow_plan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_plan
    ADD CONSTRAINT workflow_plan_pkey PRIMARY KEY (plan_id);


--
-- Name: workflow_template_occurrence workflow_template_occurrence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_template_occurrence
    ADD CONSTRAINT workflow_template_occurrence_pkey PRIMARY KEY (experience_id);


--
-- Name: workflow_template workflow_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_template
    ADD CONSTRAINT workflow_template_pkey PRIMARY KEY (template_id, version);


--
-- Name: workflow_template_use workflow_template_use_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_template_use
    ADD CONSTRAINT workflow_template_use_pkey PRIMARY KEY (use_id);


--
-- Name: workflow_template_use workflow_template_use_workflow_definition_id_workflow_versi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_template_use
    ADD CONSTRAINT workflow_template_use_workflow_definition_id_workflow_versi_key UNIQUE (workflow_definition_id, workflow_version);


--
-- Name: agent_task_context_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_task_context_created ON public.agent_task USING btree (context_id, created_at, task_id);


--
-- Name: agent_task_skill_input_resolution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_task_skill_input_resolution_idx ON public.agent_task USING btree (skill_input_resolution_id) WHERE (skill_input_resolution_id IS NOT NULL);


--
-- Name: evaluation_influence_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evaluation_influence_task_idx ON public.evaluation_influence USING btree (task_id, created_at, influence_id);


--
-- Name: evolution_experience_goal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evolution_experience_goal_idx ON public.evolution_experience USING btree (goal_id, created_at);


--
-- Name: evolution_experience_instance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evolution_experience_instance_idx ON public.evolution_experience USING btree (instance_id);


--
-- Name: evolution_experience_skill_versions_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evolution_experience_skill_versions_gin ON public.evolution_experience USING gin (skill_versions_json);


--
-- Name: evolution_trigger_fingerprint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evolution_trigger_fingerprint_idx ON public.evolution_trigger USING btree (capability_fingerprint, created_at);


--
-- Name: external_task_projection_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_task_projection_list ON public.external_task_projection USING btree (protocol, context_id, state, status_timestamp, task_id);


--
-- Name: goal_cancellation_goal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goal_cancellation_goal_idx ON public.goal_cancellation USING btree (goal_id, created_at, cancellation_id);


--
-- Name: goal_input_inference_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goal_input_inference_task_idx ON public.goal_input_inference USING btree (task_id, created_at, inference_id);


--
-- Name: goal_one_active_per_context; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX goal_one_active_per_context ON public.goal USING btree (context_id) WHERE (status = 'active'::text);


--
-- Name: goal_transition_context_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goal_transition_context_idx ON public.goal_transition USING btree (context_id, created_at, transition_id);


--
-- Name: idx_goal_patch_triggering_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_patch_triggering_task ON public.goal_patch USING btree (triggering_task_id) WHERE (triggering_task_id IS NOT NULL);


--
-- Name: idx_workflow_plan_confirmation_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_plan_confirmation_task ON public.workflow_plan USING btree (confirmation_task_id) WHERE (confirmation_task_id IS NOT NULL);


--
-- Name: implicit_feedback_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX implicit_feedback_task_idx ON public.implicit_feedback USING btree (source_task_id, created_at, feedback_id);


--
-- Name: mcp_dependency_warning_server_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_dependency_warning_server_idx ON public.mcp_dependency_warning USING btree (server_id, created_at DESC);


--
-- Name: mcp_invocation_execution_mode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_invocation_execution_mode_idx ON public.mcp_invocation USING btree (execution_mode, simulation_id, started_at);


--
-- Name: mcp_invocation_server_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_invocation_server_idx ON public.mcp_invocation USING btree (server_id, started_at DESC);


--
-- Name: mcp_invocation_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_invocation_task_idx ON public.mcp_invocation USING btree (task_id, started_at DESC) WHERE (task_id IS NOT NULL);


--
-- Name: mcp_management_operation_server_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_management_operation_server_idx ON public.mcp_management_operation USING btree (server_id, occurred_at DESC);


--
-- Name: mcp_protocol_snapshot_server_discovered_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_protocol_snapshot_server_discovered_idx ON public.mcp_protocol_snapshot USING btree (server_id, discovered_at DESC, snapshot_id);


--
-- Name: mcp_tool_server_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_tool_server_idx ON public.mcp_tool USING btree (server_id, tool_name);


--
-- Name: memory_item_provider_dimensions_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memory_item_provider_dimensions_idx ON public.memory_item USING btree (embedding_provider_id, embedding_dimensions) WHERE ((status = 'active'::text) AND (durability = 'durable'::text));


--
-- Name: memory_item_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memory_item_status_created_idx ON public.memory_item USING btree (status, created_at DESC);


--
-- Name: memory_status_transition_memory_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memory_status_transition_memory_idx ON public.memory_status_transition USING btree (memory_id, created_at, transition_id);


--
-- Name: model_invocation_stage_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_invocation_stage_created ON public.model_invocation USING btree (stage, created_at DESC);


--
-- Name: model_invocation_task_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_invocation_task_model_idx ON public.model_invocation USING btree (task_id, provider_id, model, created_at);


--
-- Name: processed_result_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX processed_result_task_idx ON public.processed_result USING btree (task_id, created_at, result_id);


--
-- Name: remote_task_binding_cancel_observation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_binding_cancel_observation_idx ON public.remote_task_binding USING btree (next_poll_at, binding_id) WHERE ((local_state = 'cancel_observing'::text) AND (terminal_at IS NULL));


--
-- Name: remote_task_binding_claim_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_binding_claim_expiry_idx ON public.remote_task_binding USING btree (poll_claim_expires_at, binding_id) WHERE (poll_claim_expires_at IS NOT NULL);


--
-- Name: remote_task_binding_context_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_binding_context_idx ON public.remote_task_binding USING btree (context_id, created_at, binding_id);


--
-- Name: remote_task_binding_poll_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_binding_poll_idx ON public.remote_task_binding USING btree (next_poll_at, binding_id) WHERE ((local_state = 'polling'::text) AND (invalidated_at IS NULL) AND (terminal_at IS NULL));


--
-- Name: remote_task_binding_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_binding_task_idx ON public.remote_task_binding USING btree (agent_task_id, created_at, binding_id);


--
-- Name: remote_task_binding_workflow_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_binding_workflow_idx ON public.remote_task_binding USING btree (workflow_instance_id, workflow_node_run_id);


--
-- Name: remote_task_cancel_attempt_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_cancel_attempt_request_idx ON public.remote_task_cancel_attempt USING btree (cancel_request_id, started_at, attempt_id);


--
-- Name: remote_task_cancel_request_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX remote_task_cancel_request_active_idx ON public.remote_task_cancel_request USING btree (binding_id) WHERE (provider_terminal_status IS NULL);


--
-- Name: remote_task_cancel_request_delivery_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_cancel_request_delivery_idx ON public.remote_task_cancel_request USING btree (delivery_status, claim_expires_at, updated_at, cancel_request_id) WHERE ((provider_terminal_status IS NULL) AND (delivery_status = ANY (ARRAY['requested'::text, 'uncertain'::text])));


--
-- Name: remote_task_control_binding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_control_binding_idx ON public.remote_task_control_event USING btree (binding_id, created_at, event_id);


--
-- Name: remote_task_control_continuation_claim_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX remote_task_control_continuation_claim_token_idx ON public.remote_task_control_event USING btree (continuation_claim_token) WHERE (continuation_claim_token IS NOT NULL);


--
-- Name: remote_task_control_continuation_inbox_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_control_continuation_inbox_idx ON public.remote_task_control_event USING btree (status, continuation_claim_expires_at, created_at, event_id) WHERE (status = ANY (ARRAY['pending'::text, 'claimed'::text]));


--
-- Name: remote_task_control_frozen_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX remote_task_control_frozen_revision_idx ON public.remote_task_control_event USING btree (binding_id, event_type, runtime_revision, result_hash) WHERE (runtime_revision IS NOT NULL);


--
-- Name: remote_task_control_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_control_pending_idx ON public.remote_task_control_event USING btree (status, created_at, event_id);


--
-- Name: remote_task_input_attempt_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_input_attempt_request_idx ON public.remote_task_input_attempt USING btree (input_request_id, started_at, attempt_id);


--
-- Name: remote_task_input_link_binding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_input_link_binding_idx ON public.remote_task_input_link USING btree (binding_id, created_at, input_request_id);


--
-- Name: remote_task_input_link_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_input_link_status_idx ON public.remote_task_input_link USING btree (status, updated_at, input_request_id) WHERE (status = ANY (ARRAY['waiting'::text, 'answered'::text, 'update_uncertain'::text]));


--
-- Name: remote_task_observation_frozen_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX remote_task_observation_frozen_revision_idx ON public.remote_task_observation USING btree (binding_id, runtime_revision) WHERE (runtime_revision IS NOT NULL);


--
-- Name: remote_task_observation_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_observation_order_idx ON public.remote_task_observation USING btree (binding_id, sequence);


--
-- Name: remote_task_observation_provider_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX remote_task_observation_provider_event_idx ON public.remote_task_observation USING btree (binding_id, provider_event_id) WHERE (provider_event_id IS NOT NULL);


--
-- Name: remote_task_protocol_attempt_binding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_task_protocol_attempt_binding_idx ON public.remote_task_protocol_attempt USING btree (binding_id, started_at, attempt_id);


--
-- Name: runtime_event_task_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_event_task_timestamp ON public.runtime_event USING btree (task_id, event_timestamp, event_id);


--
-- Name: runtime_terminal_outcome_goal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_terminal_outcome_goal_idx ON public.runtime_terminal_outcome USING btree (goal_id, goal_version, committed_at DESC);


--
-- Name: runtime_terminal_outcome_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_terminal_outcome_task_idx ON public.runtime_terminal_outcome USING btree (task_id, committed_at DESC) WHERE (task_id IS NOT NULL);


--
-- Name: skill_call_workflow_child_instance_continuation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_call_workflow_child_instance_continuation_idx ON public.skill_call_workflow USING btree (child_instance_id, status) WHERE (child_instance_id IS NOT NULL);


--
-- Name: skill_call_workflow_parent_node_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_call_workflow_parent_node_history_idx ON public.skill_call_workflow USING btree (parent_instance_id, parent_node_id, created_at DESC, call_id DESC);


--
-- Name: skill_call_workflow_pending_confirmation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_call_workflow_pending_confirmation_idx ON public.skill_call_workflow USING btree (parent_plan_id, confirmation_status, created_at DESC);


--
-- Name: skill_call_workflow_skill_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_call_workflow_skill_version_idx ON public.skill_call_workflow USING btree (skill_id, skill_version, created_at DESC);


--
-- Name: skill_draft_context_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_draft_context_created ON public.skill_draft USING btree (context_id, created_at, draft_id);


--
-- Name: skill_embedding_provider_dimensions; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_embedding_provider_dimensions ON public.skill_embedding USING btree (provider_id, dimensions);


--
-- Name: skill_evolution_correction_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_evolution_correction_candidate_idx ON public.skill_evolution_correction_experience USING btree (candidate_id, created_at, correction_id);


--
-- Name: skill_evolution_correction_capability_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_evolution_correction_capability_idx ON public.skill_evolution_correction_experience USING btree (capability_fingerprint, created_at, correction_id);


--
-- Name: skill_execution_event_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_execution_event_order_idx ON public.skill_execution_event USING btree (execution_id, sequence_number);


--
-- Name: skill_execution_event_sequence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX skill_execution_event_sequence_idx ON public.skill_execution_event USING btree (execution_id, sequence_number);


--
-- Name: skill_execution_record_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_execution_record_parent_idx ON public.skill_execution_record USING btree (parent_execution_id, created_at, execution_id) WHERE (parent_execution_id IS NOT NULL);


--
-- Name: skill_execution_record_plan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_execution_record_plan_idx ON public.skill_execution_record USING btree (workflow_plan_id, execution_id);


--
-- Name: skill_execution_record_task_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_execution_record_task_created_idx ON public.skill_execution_record USING btree (task_id, created_at, execution_id);


--
-- Name: skill_execution_reference_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_execution_reference_lookup_idx ON public.skill_execution_reference USING btree (kind, reference_id, execution_id);


--
-- Name: skill_input_resolution_current_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_input_resolution_current_idx ON public.skill_input_resolution USING btree (task_id, skill_id, skill_version, goal_version, created_at DESC, resolution_id DESC);


--
-- Name: skill_input_resolution_task_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_input_resolution_task_history_idx ON public.skill_input_resolution USING btree (task_id, created_at, resolution_id);


--
-- Name: skill_package_import_audit_checksum_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_package_import_audit_checksum_idx ON public.skill_package_import_audit USING btree (package_checksum, imported_at DESC);


--
-- Name: skill_quality_observation_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_quality_observation_recent_idx ON public.skill_quality_observation USING btree (skill_id, skill_version, created_at DESC, observation_id DESC);


--
-- Name: skill_quality_warning_skill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_quality_warning_skill_idx ON public.skill_quality_warning USING btree (skill_id, created_at DESC, warning_id DESC);


--
-- Name: skill_relation_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_relation_source_idx ON public.skill_relation USING btree (source_skill_id, relation_type);


--
-- Name: skill_relation_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_relation_target_idx ON public.skill_relation USING btree (target_skill_id, relation_type);


--
-- Name: skill_version_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_version_enabled ON public.skill_version USING btree (status, skill_id, version);


--
-- Name: skill_version_usage_default_mode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_version_usage_default_mode_idx ON public.skill_version USING btree ((((usage_specification_json -> 'modes'::text) ->> 'defaultMode'::text))) WHERE (usage_specification_json IS NOT NULL);


--
-- Name: skill_version_usage_specification_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_version_usage_specification_gin ON public.skill_version USING gin (usage_specification_json) WHERE (usage_specification_json IS NOT NULL);


--
-- Name: task_availability_snapshot_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_availability_snapshot_lookup_idx ON public.task_availability_snapshot USING btree (readiness_id, node_id);


--
-- Name: task_availability_snapshot_validity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_availability_snapshot_validity_idx ON public.task_availability_snapshot USING btree (server_id, operation_name, valid_until);


--
-- Name: task_execution_attempt_task_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_execution_attempt_task_history_idx ON public.task_execution_attempt USING btree (task_id, created_at, attempt_id);


--
-- Name: task_execution_readiness_instance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_execution_readiness_instance_idx ON public.task_execution_readiness USING btree (workflow_instance_id, workflow_node_run_id) WHERE (check_phase = 'pre_invocation'::text);


--
-- Name: task_execution_readiness_plan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_execution_readiness_plan_idx ON public.task_execution_readiness USING btree (workflow_plan_id, created_at DESC, readiness_id);


--
-- Name: task_input_request_one_waiting_per_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX task_input_request_one_waiting_per_task_idx ON public.task_input_request USING btree (task_id) WHERE (status = 'waiting'::text);


--
-- Name: task_input_request_task_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_input_request_task_history_idx ON public.task_input_request USING btree (task_id, created_at, input_request_id);


--
-- Name: temporary_skill_experience_fingerprint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX temporary_skill_experience_fingerprint_idx ON public.temporary_skill_experience USING btree (capability_fingerprint, successful, created_at);


--
-- Name: temporary_skill_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX temporary_skill_task_idx ON public.temporary_skill USING btree (task_id, status);


--
-- Name: workflow_continuation_attempt_continuation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_continuation_attempt_continuation_idx ON public.workflow_continuation_attempt USING btree (continuation_id, created_at, attempt_id);


--
-- Name: workflow_continuation_attempt_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_continuation_attempt_status_idx ON public.workflow_continuation_attempt USING btree (status, created_at, attempt_id) WHERE (status = ANY (ARRAY['claimed'::text, 'running'::text]));


--
-- Name: workflow_continuation_snapshot_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workflow_continuation_snapshot_active_idx ON public.workflow_continuation_snapshot USING btree (continuation_id) WHERE (lifecycle = 'active'::text);


--
-- Name: workflow_continuation_snapshot_active_instance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workflow_continuation_snapshot_active_instance_idx ON public.workflow_continuation_snapshot USING btree (workflow_instance_id) WHERE (lifecycle = 'active'::text);


--
-- Name: workflow_continuation_snapshot_instance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_continuation_snapshot_instance_idx ON public.workflow_continuation_snapshot USING btree (workflow_instance_id, state_version DESC);


--
-- Name: workflow_continuation_snapshot_predecessor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workflow_continuation_snapshot_predecessor_idx ON public.workflow_continuation_snapshot USING btree (predecessor_snapshot_id) WHERE (predecessor_snapshot_id IS NOT NULL);


--
-- Name: workflow_continuation_snapshot_reconcile_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_continuation_snapshot_reconcile_idx ON public.workflow_continuation_snapshot USING btree (lifecycle, updated_at, continuation_id) WHERE (lifecycle = ANY (ARRAY['building'::text, 'active'::text]));


--
-- Name: workflow_continuation_wait_binding_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_continuation_wait_binding_lookup_idx ON public.workflow_continuation_wait_binding USING btree (binding_id, snapshot_id);


--
-- Name: workflow_control_goal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_control_goal_idx ON public.workflow_control USING btree (goal_id, created_at);


--
-- Name: workflow_node_event_instance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_node_event_instance_idx ON public.workflow_node_event USING btree (instance_id, sequence);


--
-- Name: workflow_template_goal_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_template_goal_version_idx ON public.workflow_template USING btree (goal_key, version DESC, created_at DESC);


--
-- Name: workflow_template_occurrence_pattern_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_template_occurrence_pattern_idx ON public.workflow_template_occurrence USING btree (goal_key, structure_key, created_at, experience_id);


--
-- Name: remote_task_input_link remote_task_input_context_authority_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER remote_task_input_context_authority_trigger BEFORE INSERT OR UPDATE ON public.remote_task_input_link FOR EACH ROW EXECUTE FUNCTION public.enforce_remote_task_input_context_authority();


--
-- Name: agent_task agent_task_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_task
    ADD CONSTRAINT agent_task_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.conversation_context(context_id);


--
-- Name: agent_task agent_task_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_task
    ADD CONSTRAINT agent_task_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goal(goal_id);


--
-- Name: agent_task agent_task_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_task
    ADD CONSTRAINT agent_task_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.workflow_plan(plan_id);


--
-- Name: agent_task agent_task_skill_input_resolution_identity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_task
    ADD CONSTRAINT agent_task_skill_input_resolution_identity_fkey FOREIGN KEY (skill_input_resolution_id, task_id, goal_version, selected_skill_id, selected_skill_version) REFERENCES public.skill_input_resolution(resolution_id, task_id, goal_version, skill_id, skill_version) ON DELETE RESTRICT;


--
--
-- Name: agent_task agent_task_temporary_skill_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_task
    ADD CONSTRAINT agent_task_temporary_skill_fk FOREIGN KEY (temporary_skill_id) REFERENCES public.temporary_skill(temporary_skill_id);


--
-- Name: evaluation_influence evaluation_influence_experience_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_influence
    ADD CONSTRAINT evaluation_influence_experience_id_fkey FOREIGN KEY (experience_id) REFERENCES public.evolution_experience(experience_id);


--
-- Name: evaluation_influence evaluation_influence_prompt_id_prompt_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_influence
    ADD CONSTRAINT evaluation_influence_prompt_id_prompt_version_fkey FOREIGN KEY (prompt_id, prompt_version) REFERENCES public.prompt_version(prompt_id, version);


--
-- Name: evaluation_influence evaluation_influence_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_influence
    ADD CONSTRAINT evaluation_influence_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.task_quality_report(report_id);


--
-- Name: evaluation_influence evaluation_influence_skill_observation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_influence
    ADD CONSTRAINT evaluation_influence_skill_observation_id_fkey FOREIGN KEY (skill_observation_id) REFERENCES public.skill_quality_observation(observation_id);


--
-- Name: evaluation_influence evaluation_influence_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_influence
    ADD CONSTRAINT evaluation_influence_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id);


--
-- Name: evaluation_influence evaluation_influence_workflow_template_id_workflow_templat_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_influence
    ADD CONSTRAINT evaluation_influence_workflow_template_id_workflow_templat_fkey FOREIGN KEY (workflow_template_id, workflow_template_version) REFERENCES public.workflow_template(template_id, version);


--
-- Name: evolution_experience evolution_experience_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_experience
    ADD CONSTRAINT evolution_experience_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.conversation_context(context_id);


--
-- Name: evolution_experience evolution_experience_control_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_experience
    ADD CONSTRAINT evolution_experience_control_id_fkey FOREIGN KEY (control_id) REFERENCES public.workflow_control(control_id);


--
-- Name: evolution_experience evolution_experience_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_experience
    ADD CONSTRAINT evolution_experience_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goal(goal_id);


--
-- Name: evolution_experience evolution_experience_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_experience
    ADD CONSTRAINT evolution_experience_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.workflow_instance(instance_id);


--
-- Name: evolution_experience evolution_experience_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_experience
    ADD CONSTRAINT evolution_experience_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id);


--
-- Name: evolution_trigger evolution_trigger_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_trigger
    ADD CONSTRAINT evolution_trigger_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.skill_formalization_candidate(candidate_id);


--
-- Name: evolution_trigger evolution_trigger_experience_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_trigger
    ADD CONSTRAINT evolution_trigger_experience_id_fkey FOREIGN KEY (experience_id) REFERENCES public.temporary_skill_experience(experience_id);


--
-- Name: goal_cancellation goal_cancellation_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_cancellation
    ADD CONSTRAINT goal_cancellation_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goal(goal_id);


--
-- Name: goal goal_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal
    ADD CONSTRAINT goal_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.conversation_context(context_id);


--
-- Name: goal_input_inference goal_input_inference_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_input_inference
    ADD CONSTRAINT goal_input_inference_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.conversation_context(context_id);


--
-- Name: goal_input_inference goal_input_inference_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_input_inference
    ADD CONSTRAINT goal_input_inference_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id);


--
-- Name: goal_patch goal_patch_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_patch
    ADD CONSTRAINT goal_patch_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goal(goal_id);


--
-- Name: goal_patch goal_patch_triggering_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_patch
    ADD CONSTRAINT goal_patch_triggering_task_id_fkey FOREIGN KEY (triggering_task_id) REFERENCES public.agent_task(task_id);


--
-- Name: goal goal_previous_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal
    ADD CONSTRAINT goal_previous_goal_id_fkey FOREIGN KEY (previous_goal_id) REFERENCES public.goal(goal_id);


--
-- Name: goal_transition goal_transition_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_transition
    ADD CONSTRAINT goal_transition_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.conversation_context(context_id);


--
-- Name: goal_transition goal_transition_from_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_transition
    ADD CONSTRAINT goal_transition_from_goal_id_fkey FOREIGN KEY (from_goal_id) REFERENCES public.goal(goal_id);


--
-- Name: goal_transition goal_transition_to_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_transition
    ADD CONSTRAINT goal_transition_to_goal_id_fkey FOREIGN KEY (to_goal_id) REFERENCES public.goal(goal_id);


--
-- Name: implicit_feedback implicit_feedback_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.implicit_feedback
    ADD CONSTRAINT implicit_feedback_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.conversation_context(context_id);


--
-- Name: implicit_feedback implicit_feedback_source_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.implicit_feedback
    ADD CONSTRAINT implicit_feedback_source_task_id_fkey FOREIGN KEY (source_task_id) REFERENCES public.agent_task(task_id);


--
-- Name: implicit_feedback implicit_feedback_trigger_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.implicit_feedback
    ADD CONSTRAINT implicit_feedback_trigger_task_id_fkey FOREIGN KEY (trigger_task_id) REFERENCES public.agent_task(task_id);


--
-- Name: mcp_protocol_snapshot mcp_protocol_snapshot_server_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_protocol_snapshot
    ADD CONSTRAINT mcp_protocol_snapshot_server_id_fkey FOREIGN KEY (server_id) REFERENCES public.mcp_server(server_id) ON DELETE RESTRICT;


--
-- Name: mcp_server mcp_server_current_protocol_snapshot_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_server
    ADD CONSTRAINT mcp_server_current_protocol_snapshot_fkey FOREIGN KEY (current_protocol_snapshot_id) REFERENCES public.mcp_protocol_snapshot(snapshot_id) ON DELETE RESTRICT;


--
-- Name: mcp_tool mcp_tool_server_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_tool
    ADD CONSTRAINT mcp_tool_server_id_fkey FOREIGN KEY (server_id) REFERENCES public.mcp_server(server_id) ON DELETE CASCADE;


--
-- Name: memory_status_transition memory_status_transition_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_status_transition
    ADD CONSTRAINT memory_status_transition_memory_id_fkey FOREIGN KEY (memory_id) REFERENCES public.memory_item(memory_id);


--
-- Name: memory_status_transition memory_status_transition_replacement_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_status_transition
    ADD CONSTRAINT memory_status_transition_replacement_memory_id_fkey FOREIGN KEY (replacement_memory_id) REFERENCES public.memory_item(memory_id);


--
-- Name: model_invocation model_invocation_prompt_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_invocation
    ADD CONSTRAINT model_invocation_prompt_fk FOREIGN KEY (prompt_id, prompt_version) REFERENCES public.prompt_version(prompt_id, version);


--
-- Name: model_invocation model_invocation_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_invocation
    ADD CONSTRAINT model_invocation_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id);


--
-- Name: processed_result processed_result_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_result
    ADD CONSTRAINT processed_result_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id);


--
-- Name: prompt prompt_current_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt
    ADD CONSTRAINT prompt_current_version_fk FOREIGN KEY (prompt_id, current_version) REFERENCES public.prompt_version(prompt_id, version);


--
-- Name: prompt_version prompt_version_prompt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_version
    ADD CONSTRAINT prompt_version_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompt(prompt_id) ON DELETE CASCADE;


--
-- Name: prompt_version prompt_version_prompt_id_previous_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_version
    ADD CONSTRAINT prompt_version_prompt_id_previous_version_fkey FOREIGN KEY (prompt_id, previous_version) REFERENCES public.prompt_version(prompt_id, version);


--
-- Name: remote_task_binding remote_task_binding_agent_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_binding
    ADD CONSTRAINT remote_task_binding_agent_task_id_fkey FOREIGN KEY (agent_task_id) REFERENCES public.agent_task(task_id) ON DELETE RESTRICT;


--
-- Name: remote_task_binding remote_task_binding_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_binding
    ADD CONSTRAINT remote_task_binding_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.conversation_context(context_id) ON DELETE RESTRICT;


--
-- Name: remote_task_binding remote_task_binding_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_binding
    ADD CONSTRAINT remote_task_binding_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goal(goal_id) ON DELETE RESTRICT;


--
-- Name: remote_task_binding remote_task_binding_mcp_invocation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_binding
    ADD CONSTRAINT remote_task_binding_mcp_invocation_id_fkey FOREIGN KEY (mcp_invocation_id) REFERENCES public.mcp_invocation(invocation_id) ON DELETE RESTRICT;


--
-- Name: remote_task_binding remote_task_binding_workflow_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_binding
    ADD CONSTRAINT remote_task_binding_workflow_instance_id_fkey FOREIGN KEY (workflow_instance_id) REFERENCES public.workflow_instance(instance_id) ON DELETE RESTRICT;


--
-- Name: remote_task_binding remote_task_binding_workflow_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_binding
    ADD CONSTRAINT remote_task_binding_workflow_plan_id_fkey FOREIGN KEY (workflow_plan_id) REFERENCES public.workflow_plan(plan_id) ON DELETE RESTRICT;


--
-- Name: remote_task_cancel_attempt remote_task_cancel_attempt_cancel_request_id_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_cancel_attempt
    ADD CONSTRAINT remote_task_cancel_attempt_cancel_request_id_binding_id_fkey FOREIGN KEY (cancel_request_id, binding_id) REFERENCES public.remote_task_cancel_request(cancel_request_id, binding_id) ON DELETE RESTRICT;


--
-- Name: remote_task_cancel_request remote_task_cancel_request_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_cancel_request
    ADD CONSTRAINT remote_task_cancel_request_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES public.remote_task_binding(binding_id) ON DELETE RESTRICT;


--
-- Name: remote_task_control_event remote_task_control_event_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_control_event
    ADD CONSTRAINT remote_task_control_event_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES public.remote_task_binding(binding_id) ON DELETE RESTRICT;


--
-- Name: remote_task_input_attempt remote_task_input_attempt_input_request_id_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_input_attempt
    ADD CONSTRAINT remote_task_input_attempt_input_request_id_binding_id_fkey FOREIGN KEY (input_request_id, binding_id) REFERENCES public.remote_task_input_link(input_request_id, binding_id) ON DELETE RESTRICT;


--
-- Name: remote_task_input_link remote_task_input_link_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_input_link
    ADD CONSTRAINT remote_task_input_link_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES public.remote_task_binding(binding_id) ON DELETE RESTRICT;


--
-- Name: remote_task_input_link remote_task_input_link_binding_id_remote_task_id_workflow__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_input_link
    ADD CONSTRAINT remote_task_input_link_binding_id_remote_task_id_workflow__fkey FOREIGN KEY (binding_id, remote_task_id, workflow_instance_id, workflow_node_id, workflow_node_run_id) REFERENCES public.remote_task_binding(binding_id, remote_task_id, workflow_instance_id, workflow_node_id, workflow_node_run_id) ON DELETE RESTRICT;


--
-- Name: remote_task_input_link remote_task_input_link_control_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_input_link
    ADD CONSTRAINT remote_task_input_link_control_event_id_fkey FOREIGN KEY (control_event_id) REFERENCES public.remote_task_control_event(event_id) ON DELETE RESTRICT;


--
-- Name: remote_task_input_link remote_task_input_link_input_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_input_link
    ADD CONSTRAINT remote_task_input_link_input_request_id_fkey FOREIGN KEY (input_request_id) REFERENCES public.task_input_request(input_request_id) ON DELETE RESTRICT;


--
-- Name: remote_task_input_link remote_task_input_link_workflow_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_input_link
    ADD CONSTRAINT remote_task_input_link_workflow_instance_id_fkey FOREIGN KEY (workflow_instance_id) REFERENCES public.workflow_instance(instance_id) ON DELETE RESTRICT;


--
-- Name: remote_task_observation remote_task_observation_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_observation
    ADD CONSTRAINT remote_task_observation_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES public.remote_task_binding(binding_id) ON DELETE RESTRICT;


--
-- Name: remote_task_protocol_attempt remote_task_protocol_attempt_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_task_protocol_attempt
    ADD CONSTRAINT remote_task_protocol_attempt_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES public.remote_task_binding(binding_id) ON DELETE RESTRICT;


--
-- Name: runtime_event runtime_event_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_event
    ADD CONSTRAINT runtime_event_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.conversation_context(context_id);


--
-- Name: runtime_event runtime_event_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_event
    ADD CONSTRAINT runtime_event_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id);


--
-- Name: runtime_terminal_outcome runtime_terminal_outcome_control_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_terminal_outcome
    ADD CONSTRAINT runtime_terminal_outcome_control_id_fkey FOREIGN KEY (control_id) REFERENCES public.workflow_control(control_id) ON DELETE RESTRICT;


--
-- Name: runtime_terminal_outcome runtime_terminal_outcome_final_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_terminal_outcome
    ADD CONSTRAINT runtime_terminal_outcome_final_instance_id_fkey FOREIGN KEY (final_instance_id) REFERENCES public.workflow_instance(instance_id) ON DELETE RESTRICT;


--
-- Name: runtime_terminal_outcome runtime_terminal_outcome_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_terminal_outcome
    ADD CONSTRAINT runtime_terminal_outcome_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goal(goal_id) ON DELETE RESTRICT;


--
-- Name: runtime_terminal_outcome runtime_terminal_outcome_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_terminal_outcome
    ADD CONSTRAINT runtime_terminal_outcome_result_id_fkey FOREIGN KEY (result_id) REFERENCES public.processed_result(result_id) ON DELETE RESTRICT;


--
-- Name: runtime_terminal_outcome runtime_terminal_outcome_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_terminal_outcome
    ADD CONSTRAINT runtime_terminal_outcome_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id) ON DELETE RESTRICT;


--
-- Name: skill_call_workflow skill_call_workflow_child_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_call_workflow
    ADD CONSTRAINT skill_call_workflow_child_instance_id_fkey FOREIGN KEY (child_instance_id) REFERENCES public.workflow_instance(instance_id) ON DELETE CASCADE;


--
-- Name: skill_call_workflow skill_call_workflow_child_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_call_workflow
    ADD CONSTRAINT skill_call_workflow_child_plan_id_fkey FOREIGN KEY (child_plan_id) REFERENCES public.workflow_plan(plan_id);


--
-- Name: skill_call_workflow skill_call_workflow_parent_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_call_workflow
    ADD CONSTRAINT skill_call_workflow_parent_instance_id_fkey FOREIGN KEY (parent_instance_id) REFERENCES public.workflow_instance(instance_id) ON DELETE CASCADE;


--
-- Name: skill_call_workflow skill_call_workflow_parent_plan_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_call_workflow
    ADD CONSTRAINT skill_call_workflow_parent_plan_fk FOREIGN KEY (parent_plan_id) REFERENCES public.workflow_plan(plan_id);


--
-- Name: skill_call_workflow skill_call_workflow_skill_id_skill_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_call_workflow
    ADD CONSTRAINT skill_call_workflow_skill_id_skill_version_fkey FOREIGN KEY (skill_id, skill_version) REFERENCES public.skill_version(skill_id, version);


--
-- Name: skill_draft skill_draft_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_draft
    ADD CONSTRAINT skill_draft_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.conversation_context(context_id);


--
-- Name: skill_draft skill_draft_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_draft
    ADD CONSTRAINT skill_draft_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id);


--
-- Name: skill_embedding skill_embedding_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_embedding
    ADD CONSTRAINT skill_embedding_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skill(skill_id) ON DELETE CASCADE;


--
-- Name: skill_embedding skill_embedding_skill_id_skill_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_embedding
    ADD CONSTRAINT skill_embedding_skill_id_skill_version_fkey FOREIGN KEY (skill_id, skill_version) REFERENCES public.skill_version(skill_id, version);


--
-- Name: skill_evolution_correction_experience skill_evolution_correction_experience_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_evolution_correction_experience
    ADD CONSTRAINT skill_evolution_correction_experience_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.skill_formalization_candidate(candidate_id);


--
-- Name: skill_execution_event skill_execution_event_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_event
    ADD CONSTRAINT skill_execution_event_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES public.skill_execution_record(execution_id);


--
-- Name: skill_execution_record skill_execution_record_parent_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_record
    ADD CONSTRAINT skill_execution_record_parent_execution_id_fkey FOREIGN KEY (parent_execution_id) REFERENCES public.skill_execution_record(execution_id);


--
-- Name: skill_execution_record skill_execution_record_skill_id_skill_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_record
    ADD CONSTRAINT skill_execution_record_skill_id_skill_version_fkey FOREIGN KEY (skill_id, skill_version) REFERENCES public.skill_version(skill_id, version);


--
-- Name: skill_execution_record skill_execution_record_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_record
    ADD CONSTRAINT skill_execution_record_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id);


--
-- Name: skill_execution_record skill_execution_record_workflow_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_record
    ADD CONSTRAINT skill_execution_record_workflow_plan_id_fkey FOREIGN KEY (workflow_plan_id) REFERENCES public.workflow_plan(plan_id);


--
-- Name: skill_execution_reference skill_execution_reference_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_execution_reference
    ADD CONSTRAINT skill_execution_reference_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES public.skill_execution_record(execution_id);


--
-- Name: skill_input_resolution skill_input_resolution_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_input_resolution
    ADD CONSTRAINT skill_input_resolution_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goal(goal_id) ON DELETE RESTRICT;


--
-- Name: skill_input_resolution skill_input_resolution_skill_id_skill_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_input_resolution
    ADD CONSTRAINT skill_input_resolution_skill_id_skill_version_fkey FOREIGN KEY (skill_id, skill_version) REFERENCES public.skill_version(skill_id, version) ON DELETE RESTRICT;


--
-- Name: skill_input_resolution skill_input_resolution_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_input_resolution
    ADD CONSTRAINT skill_input_resolution_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id) ON DELETE CASCADE;


--
-- Name: skill_package_import_audit skill_package_import_audit_skill_id_skill_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_package_import_audit
    ADD CONSTRAINT skill_package_import_audit_skill_id_skill_version_fkey FOREIGN KEY (skill_id, skill_version) REFERENCES public.skill_version(skill_id, version);


--
-- Name: skill_performance_metrics skill_performance_metrics_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_performance_metrics
    ADD CONSTRAINT skill_performance_metrics_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skill(skill_id) ON DELETE CASCADE;


--
-- Name: skill_quality_observation skill_quality_observation_skill_id_skill_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_quality_observation
    ADD CONSTRAINT skill_quality_observation_skill_id_skill_version_fkey FOREIGN KEY (skill_id, skill_version) REFERENCES public.skill_version(skill_id, version);


--
-- Name: skill_quality_warning skill_quality_warning_skill_id_skill_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_quality_warning
    ADD CONSTRAINT skill_quality_warning_skill_id_skill_version_fkey FOREIGN KEY (skill_id, skill_version) REFERENCES public.skill_version(skill_id, version);


--
-- Name: skill_relation skill_relation_source_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_relation
    ADD CONSTRAINT skill_relation_source_skill_id_fkey FOREIGN KEY (source_skill_id) REFERENCES public.skill(skill_id) ON DELETE CASCADE;


--
-- Name: skill_relation skill_relation_target_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_relation
    ADD CONSTRAINT skill_relation_target_skill_id_fkey FOREIGN KEY (target_skill_id) REFERENCES public.skill(skill_id) ON DELETE CASCADE;


--
-- Name: skill_replacement_plan skill_replacement_plan_selection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_replacement_plan
    ADD CONSTRAINT skill_replacement_plan_selection_id_fkey FOREIGN KEY (selection_id) REFERENCES public.skill_selection_record(selection_id);


--
-- Name: skill_version skill_version_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_version
    ADD CONSTRAINT skill_version_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skill(skill_id) ON DELETE CASCADE;


--
-- Name: skill_version skill_version_skill_id_previous_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_version
    ADD CONSTRAINT skill_version_skill_id_previous_version_fkey FOREIGN KEY (skill_id, previous_version) REFERENCES public.skill_version(skill_id, version);


--
-- Name: stage_model_route stage_model_route_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_model_route
    ADD CONSTRAINT stage_model_route_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.model_provider(provider_id);


--
-- Name: task_availability_snapshot task_availability_snapshot_readiness_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_availability_snapshot
    ADD CONSTRAINT task_availability_snapshot_readiness_id_fkey FOREIGN KEY (readiness_id) REFERENCES public.task_execution_readiness(readiness_id) ON DELETE RESTRICT;


--
-- Name: task_execution_attempt task_execution_attempt_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_execution_attempt
    ADD CONSTRAINT task_execution_attempt_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.conversation_context(context_id) ON DELETE CASCADE;


--
-- Name: task_execution_attempt task_execution_attempt_input_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_execution_attempt
    ADD CONSTRAINT task_execution_attempt_input_request_id_fkey FOREIGN KEY (input_request_id) REFERENCES public.task_input_request(input_request_id) ON DELETE RESTRICT;


--
-- Name: task_execution_attempt task_execution_attempt_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_execution_attempt
    ADD CONSTRAINT task_execution_attempt_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id) ON DELETE CASCADE;


--
-- Name: task_execution_readiness task_execution_readiness_workflow_plan_id_plan_attempt_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_execution_readiness
    ADD CONSTRAINT task_execution_readiness_workflow_plan_id_plan_attempt_fkey FOREIGN KEY (workflow_plan_id, plan_attempt) REFERENCES public.workflow_plan_attempt(plan_id, attempt) ON DELETE RESTRICT;


--
-- Name: task_input_request task_input_request_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_input_request
    ADD CONSTRAINT task_input_request_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.conversation_context(context_id) ON DELETE CASCADE;


--
-- Name: task_input_request task_input_request_control_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_input_request
    ADD CONSTRAINT task_input_request_control_id_fkey FOREIGN KEY (control_id) REFERENCES public.workflow_control(control_id) ON DELETE RESTRICT;


--
-- Name: task_input_request task_input_request_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_input_request
    ADD CONSTRAINT task_input_request_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id) ON DELETE CASCADE;


--
-- Name: task_input_response task_input_response_input_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_input_response
    ADD CONSTRAINT task_input_response_input_request_id_fkey FOREIGN KEY (input_request_id) REFERENCES public.task_input_request(input_request_id) ON DELETE RESTRICT;


--
-- Name: task_input_response task_input_response_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_input_response
    ADD CONSTRAINT task_input_response_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id) ON DELETE CASCADE;


--
-- Name: task_quality_report task_quality_report_processed_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_quality_report
    ADD CONSTRAINT task_quality_report_processed_result_id_fkey FOREIGN KEY (processed_result_id) REFERENCES public.processed_result(result_id);


--
-- Name: task_quality_report task_quality_report_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_quality_report
    ADD CONSTRAINT task_quality_report_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id);


--
-- Name: task_quality_report task_quality_report_workflow_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_quality_report
    ADD CONSTRAINT task_quality_report_workflow_instance_id_fkey FOREIGN KEY (workflow_instance_id) REFERENCES public.workflow_instance(instance_id);


--
-- Name: temporary_skill_experience temporary_skill_experience_temporary_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.temporary_skill_experience
    ADD CONSTRAINT temporary_skill_experience_temporary_skill_id_fkey FOREIGN KEY (temporary_skill_id) REFERENCES public.temporary_skill(temporary_skill_id);


--
-- Name: workflow_continuation_attempt workflow_continuation_attempt_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_attempt
    ADD CONSTRAINT workflow_continuation_attempt_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.remote_task_control_event(event_id) ON DELETE RESTRICT;


--
-- Name: workflow_continuation_attempt workflow_continuation_attempt_snapshot_id_continuation_id__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_attempt
    ADD CONSTRAINT workflow_continuation_attempt_snapshot_id_continuation_id__fkey FOREIGN KEY (snapshot_id, continuation_id, snapshot_state_version) REFERENCES public.workflow_continuation_snapshot(snapshot_id, continuation_id, state_version) ON DELETE RESTRICT;


--
-- Name: workflow_continuation_attempt workflow_continuation_attempt_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_attempt
    ADD CONSTRAINT workflow_continuation_attempt_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.workflow_continuation_snapshot(snapshot_id) ON DELETE RESTRICT;


--
-- Name: workflow_continuation_attempt workflow_continuation_attempt_workflow_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_attempt
    ADD CONSTRAINT workflow_continuation_attempt_workflow_instance_id_fkey FOREIGN KEY (workflow_instance_id) REFERENCES public.workflow_instance(instance_id) ON DELETE RESTRICT;


--
-- Name: workflow_continuation_snapshot workflow_continuation_snapshot_agent_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_snapshot
    ADD CONSTRAINT workflow_continuation_snapshot_agent_task_id_fkey FOREIGN KEY (agent_task_id) REFERENCES public.agent_task(task_id) ON DELETE RESTRICT;


--
-- Name: workflow_continuation_snapshot workflow_continuation_snapshot_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_snapshot
    ADD CONSTRAINT workflow_continuation_snapshot_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.conversation_context(context_id) ON DELETE RESTRICT;


--
-- Name: workflow_continuation_snapshot workflow_continuation_snapshot_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_snapshot
    ADD CONSTRAINT workflow_continuation_snapshot_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goal(goal_id) ON DELETE RESTRICT;


--
-- Name: workflow_continuation_snapshot workflow_continuation_snapshot_predecessor_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_snapshot
    ADD CONSTRAINT workflow_continuation_snapshot_predecessor_snapshot_id_fkey FOREIGN KEY (predecessor_snapshot_id) REFERENCES public.workflow_continuation_snapshot(snapshot_id) ON DELETE RESTRICT;


--
-- Name: workflow_continuation_snapshot workflow_continuation_snapshot_workflow_control_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_snapshot
    ADD CONSTRAINT workflow_continuation_snapshot_workflow_control_id_fkey FOREIGN KEY (workflow_control_id) REFERENCES public.workflow_control(control_id) ON DELETE RESTRICT;


--
-- Name: workflow_continuation_snapshot workflow_continuation_snapshot_workflow_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_snapshot
    ADD CONSTRAINT workflow_continuation_snapshot_workflow_instance_id_fkey FOREIGN KEY (workflow_instance_id) REFERENCES public.workflow_instance(instance_id) ON DELETE RESTRICT;


--
-- Name: workflow_continuation_snapshot workflow_continuation_snapshot_workflow_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_snapshot
    ADD CONSTRAINT workflow_continuation_snapshot_workflow_plan_id_fkey FOREIGN KEY (workflow_plan_id) REFERENCES public.workflow_plan(plan_id) ON DELETE RESTRICT;


--
-- Name: workflow_continuation_wait_binding workflow_continuation_wait_binding_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_continuation_wait_binding
    ADD CONSTRAINT workflow_continuation_wait_binding_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES public.remote_task_binding(binding_id) ON DELETE RESTRICT;


--
-- Name: workflow_control workflow_control_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control
    ADD CONSTRAINT workflow_control_context_id_fkey FOREIGN KEY (context_id) REFERENCES public.conversation_context(context_id);


--
-- Name: workflow_control workflow_control_current_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control
    ADD CONSTRAINT workflow_control_current_plan_id_fkey FOREIGN KEY (current_plan_id) REFERENCES public.workflow_plan(plan_id);


--
-- Name: workflow_control workflow_control_final_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control
    ADD CONSTRAINT workflow_control_final_instance_id_fkey FOREIGN KEY (final_instance_id) REFERENCES public.workflow_instance(instance_id);


--
-- Name: workflow_control workflow_control_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control
    ADD CONSTRAINT workflow_control_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goal(goal_id);


--
-- Name: workflow_control_round workflow_control_round_control_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control_round
    ADD CONSTRAINT workflow_control_round_control_id_fkey FOREIGN KEY (control_id) REFERENCES public.workflow_control(control_id) ON DELETE CASCADE;


--
-- Name: workflow_control_round workflow_control_round_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control_round
    ADD CONSTRAINT workflow_control_round_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.workflow_instance(instance_id);


--
-- Name: workflow_control_round workflow_control_round_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control_round
    ADD CONSTRAINT workflow_control_round_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.workflow_plan(plan_id);


--
-- Name: workflow_control_round workflow_control_round_terminal_outcome_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control_round
    ADD CONSTRAINT workflow_control_round_terminal_outcome_id_fkey FOREIGN KEY (terminal_outcome_id) REFERENCES public.runtime_terminal_outcome(outcome_id) ON DELETE RESTRICT;


--
-- Name: workflow_control workflow_control_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control
    ADD CONSTRAINT workflow_control_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.agent_task(task_id);


--
-- Name: workflow_control workflow_control_terminal_outcome_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_control
    ADD CONSTRAINT workflow_control_terminal_outcome_id_fkey FOREIGN KEY (terminal_outcome_id) REFERENCES public.runtime_terminal_outcome(outcome_id) ON DELETE RESTRICT;


--
-- Name: workflow_instance workflow_instance_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instance
    ADD CONSTRAINT workflow_instance_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.workflow_plan(plan_id);


--
-- Name: workflow_node_event workflow_node_event_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_node_event
    ADD CONSTRAINT workflow_node_event_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.workflow_instance(instance_id) ON DELETE CASCADE;


--
-- Name: workflow_plan workflow_plan_confirmation_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_plan
    ADD CONSTRAINT workflow_plan_confirmation_task_id_fkey FOREIGN KEY (confirmation_task_id) REFERENCES public.agent_task(task_id);


--
-- Name: workflow_plan workflow_plan_source_confirmed_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_plan
    ADD CONSTRAINT workflow_plan_source_confirmed_plan_id_fkey FOREIGN KEY (source_confirmed_plan_id) REFERENCES public.workflow_plan(plan_id);


--
-- Name: workflow_plan workflow_plan_source_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_plan
    ADD CONSTRAINT workflow_plan_source_plan_id_fkey FOREIGN KEY (source_plan_id) REFERENCES public.workflow_plan(plan_id);


--
-- Name: workflow_template_occurrence workflow_template_occurrence_experience_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_template_occurrence
    ADD CONSTRAINT workflow_template_occurrence_experience_id_fkey FOREIGN KEY (experience_id) REFERENCES public.evolution_experience(experience_id);


--
-- Name: workflow_template_occurrence workflow_template_occurrence_quality_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_template_occurrence
    ADD CONSTRAINT workflow_template_occurrence_quality_report_id_fkey FOREIGN KEY (quality_report_id) REFERENCES public.task_quality_report(report_id);


--
-- Name: workflow_template_use workflow_template_use_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_template_use
    ADD CONSTRAINT workflow_template_use_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.workflow_plan(plan_id);


--
-- Name: workflow_template_use workflow_template_use_template_id_template_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_template_use
    ADD CONSTRAINT workflow_template_use_template_id_template_version_fkey FOREIGN KEY (template_id, template_version) REFERENCES public.workflow_template(template_id, version);


--
-- SDAR v1.2.2 User Goal planning, execution, outcome, recovery and Business Event authority.
CREATE TABLE public.user_goal_contract (
    goal_id text NOT NULL REFERENCES public.goal(goal_id),
    goal_version integer NOT NULL CHECK (goal_version > 0),
    schema_version text NOT NULL CHECK (schema_version = '1.0'),
    contract_hash text NOT NULL CHECK (contract_hash ~ '^sha256:[0-9a-f]{64}$'),
    contract_json jsonb NOT NULL CHECK (jsonb_typeof(contract_json) = 'object' AND octet_length(contract_json::text) <= 262144),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (goal_id, goal_version),
    UNIQUE (contract_hash)
);

CREATE TABLE public.user_goal_plan (
    plan_id text PRIMARY KEY,
    goal_id text NOT NULL,
    goal_version integer NOT NULL,
    revision integer NOT NULL CHECK (revision BETWEEN 1 AND 4),
    revision_kind text NOT NULL CHECK (revision_kind IN ('initial','goal_patch','user_revision','recovery','event_impact')),
    source_plan_id text REFERENCES public.user_goal_plan(plan_id),
    status text NOT NULL CHECK (status IN ('planning','validated','active','revision_pending','superseded','completed','failed','canceled')),
    contract_hash text NOT NULL CHECK (contract_hash ~ '^sha256:[0-9a-f]{64}$'),
    content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
    plan_json jsonb NOT NULL CHECK (jsonb_typeof(plan_json) = 'object' AND octet_length(plan_json::text) <= 262144),
    lock_version bigint NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    FOREIGN KEY (goal_id, goal_version) REFERENCES public.user_goal_contract(goal_id, goal_version),
    UNIQUE (goal_id, goal_version, revision),
    UNIQUE (goal_id, goal_version, content_hash)
);

CREATE UNIQUE INDEX user_goal_plan_one_current_idx
ON public.user_goal_plan(goal_id, goal_version)
WHERE status IN ('planning','validated','active','revision_pending');

CREATE TABLE public.skill_goal (
    skill_goal_id text PRIMARY KEY,
    plan_id text NOT NULL REFERENCES public.user_goal_plan(plan_id) ON DELETE CASCADE,
    ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 16),
    status text NOT NULL CHECK (status IN ('pending','ready','dispatch_intent','selecting','executing','judging','achieved','partially_achieved','failed','blocked','superseded','canceled')),
    contract_json jsonb NOT NULL CHECK (jsonb_typeof(contract_json) = 'object' AND octet_length(contract_json::text) <= 262144),
    lock_version bigint NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (plan_id, ordinal),
    UNIQUE (plan_id, skill_goal_id)
);

CREATE TABLE public.skill_goal_dependency (
    dependency_id text PRIMARY KEY,
    plan_id text NOT NULL REFERENCES public.user_goal_plan(plan_id) ON DELETE CASCADE,
    predecessor_skill_goal_id text NOT NULL REFERENCES public.skill_goal(skill_goal_id) ON DELETE CASCADE,
    successor_skill_goal_id text NOT NULL REFERENCES public.skill_goal(skill_goal_id) ON DELETE CASCADE,
    predicate text NOT NULL CHECK (predicate IN ('required','optional')),
    CHECK (predecessor_skill_goal_id <> successor_skill_goal_id),
    UNIQUE (plan_id, predecessor_skill_goal_id, successor_skill_goal_id)
);

CREATE TABLE public.skill_outcome_specification (
    skill_id text NOT NULL,
    skill_version integer NOT NULL CHECK (skill_version > 0),
    schema_version text NOT NULL CHECK (schema_version = '1.0'),
    specification_hash text NOT NULL CHECK (specification_hash ~ '^sha256:[0-9a-f]{64}$'),
    specification_json jsonb NOT NULL CHECK (jsonb_typeof(specification_json) = 'object' AND octet_length(specification_json::text) <= 262144),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (skill_id, skill_version),
    FOREIGN KEY (skill_id, skill_version) REFERENCES public.skill_version(skill_id, version),
    UNIQUE (specification_hash)
);

CREATE TABLE public.skill_attempt (
    attempt_id text PRIMARY KEY,
    plan_id text NOT NULL REFERENCES public.user_goal_plan(plan_id),
    skill_goal_id text NOT NULL REFERENCES public.skill_goal(skill_goal_id),
    ordinal integer NOT NULL CHECK (ordinal > 0),
    status text NOT NULL CHECK (status IN ('dispatch_intent','selecting','planning_workflow','awaiting_confirmation','running','waiting_external','judging','achieved','partially_achieved','failed','canceled','superseded')),
    strategy_fingerprint text NOT NULL CHECK (strategy_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
    attempt_json jsonb NOT NULL CHECK (jsonb_typeof(attempt_json) = 'object' AND octet_length(attempt_json::text) <= 262144),
    lock_version bigint NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (skill_goal_id, ordinal),
    UNIQUE (skill_goal_id, strategy_fingerprint)
);

CREATE UNIQUE INDEX skill_attempt_one_active_idx
ON public.skill_attempt(skill_goal_id)
WHERE status IN ('dispatch_intent','selecting','planning_workflow','awaiting_confirmation','running','waiting_external','judging');

CREATE TABLE public.skill_execution_contract (
    execution_contract_id text PRIMARY KEY,
    attempt_id text NOT NULL UNIQUE REFERENCES public.skill_attempt(attempt_id),
    plan_id text NOT NULL REFERENCES public.user_goal_plan(plan_id),
    skill_goal_id text NOT NULL REFERENCES public.skill_goal(skill_goal_id),
    skill_id text NOT NULL,
    skill_version integer NOT NULL,
    contract_hash text NOT NULL UNIQUE CHECK (contract_hash ~ '^sha256:[0-9a-f]{64}$'),
    contract_json jsonb NOT NULL CHECK (jsonb_typeof(contract_json) = 'object' AND octet_length(contract_json::text) <= 262144),
    created_at timestamptz NOT NULL,
    FOREIGN KEY (skill_id, skill_version) REFERENCES public.skill_version(skill_id, version)
);

ALTER TABLE ONLY public.agent_task
    ADD CONSTRAINT agent_task_skill_selection_fk
    FOREIGN KEY (skill_selection_id)
    REFERENCES public.skill_selection_record(selection_id);

ALTER TABLE ONLY public.agent_task
    ADD CONSTRAINT agent_task_user_goal_plan_fk FOREIGN KEY (user_goal_plan_id)
      REFERENCES public.user_goal_plan(plan_id),
    ADD CONSTRAINT agent_task_skill_goal_fk FOREIGN KEY (skill_goal_id)
      REFERENCES public.skill_goal(skill_goal_id),
    ADD CONSTRAINT agent_task_skill_attempt_fk FOREIGN KEY (skill_attempt_id)
      REFERENCES public.skill_attempt(attempt_id),
    ADD CONSTRAINT agent_task_skill_execution_contract_fk FOREIGN KEY (skill_execution_contract_id)
      REFERENCES public.skill_execution_contract(execution_contract_id),
    ADD CONSTRAINT agent_task_skill_goal_attempt_binding_check
      CHECK ((user_goal_plan_id IS NULL) = (skill_goal_id IS NULL)
        AND (skill_goal_id IS NULL) = (skill_attempt_id IS NULL));

CREATE TABLE public.task_goal_contract (
    task_goal_contract_id text PRIMARY KEY,
    attempt_id text NOT NULL REFERENCES public.skill_attempt(attempt_id),
    agent_task_id text NOT NULL REFERENCES public.agent_task(task_id),
    remote_task_binding_id text REFERENCES public.remote_task_binding(binding_id),
    contract_hash text NOT NULL CHECK (contract_hash ~ '^sha256:[0-9a-f]{64}$'),
    contract_json jsonb NOT NULL CHECK (jsonb_typeof(contract_json) = 'object' AND octet_length(contract_json::text) <= 262144),
    created_at timestamptz NOT NULL,
    UNIQUE (attempt_id, agent_task_id),
    UNIQUE (remote_task_binding_id)
);

CREATE TABLE public.outcome_decision (
    outcome_decision_id text PRIMARY KEY,
    level text NOT NULL CHECK (level IN ('task_goal','skill_goal','user_goal')),
    subject_id text NOT NULL,
    plan_id text NOT NULL REFERENCES public.user_goal_plan(plan_id),
    status text NOT NULL CHECK (status IN ('achieved','partially_achieved','not_achieved','unknown')),
    confidence text NOT NULL CHECK (confidence IN ('high','medium','low')),
    decision_json jsonb NOT NULL CHECK (jsonb_typeof(decision_json) = 'object' AND octet_length(decision_json::text) <= 262144),
    created_at timestamptz NOT NULL,
    CHECK (NOT (confidence = 'low' AND status = 'achieved')),
    UNIQUE (level, subject_id, outcome_decision_id)
);

CREATE UNIQUE INDEX outcome_decision_user_goal_achieved_idx
ON public.outcome_decision(subject_id)
WHERE level = 'user_goal' AND status = 'achieved';

CREATE TABLE public.progress_observation (
    progress_observation_id text PRIMARY KEY,
    plan_id text NOT NULL REFERENCES public.user_goal_plan(plan_id),
    classification text NOT NULL CHECK (classification IN ('progressing','stalled','regressing','complete')),
    vector_json jsonb NOT NULL CHECK (jsonb_typeof(vector_json) = 'object' AND octet_length(vector_json::text) <= 262144),
    observed_at timestamptz NOT NULL
);

CREATE TABLE public.completed_effect (
    completed_effect_id text PRIMARY KEY,
    goal_id text NOT NULL REFERENCES public.goal(goal_id),
    plan_id text NOT NULL REFERENCES public.user_goal_plan(plan_id),
    skill_goal_id text REFERENCES public.skill_goal(skill_goal_id),
    status text NOT NULL CHECK (status IN ('observed','verified','invalidated')),
    effect_fingerprint text NOT NULL CHECK (effect_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
    effect_json jsonb NOT NULL CHECK (jsonb_typeof(effect_json) = 'object' AND octet_length(effect_json::text) <= 262144),
    predecessor_effect_id text REFERENCES public.completed_effect(completed_effect_id),
    created_at timestamptz NOT NULL,
    UNIQUE (goal_id, effect_fingerprint, completed_effect_id)
);

CREATE TABLE public.recovery_decision (
    recovery_decision_id text PRIMARY KEY,
    plan_id text NOT NULL REFERENCES public.user_goal_plan(plan_id),
    skill_goal_id text REFERENCES public.skill_goal(skill_goal_id),
    attempt_id text REFERENCES public.skill_attempt(attempt_id),
    action text NOT NULL CHECK (action IN ('no_action','reconcile_remote_task','replacement_attempt','revise_plan','request_input','fail_goal')),
    reason_code text NOT NULL,
    strategy_fingerprint text NOT NULL CHECK (strategy_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
    decision_json jsonb NOT NULL CHECK (jsonb_typeof(decision_json) = 'object' AND octet_length(decision_json::text) <= 262144),
    created_at timestamptz NOT NULL,
    UNIQUE (plan_id, skill_goal_id, strategy_fingerprint)
);

CREATE TABLE public.business_event_subscription (
    subscription_id text PRIMARY KEY,
    provider_id text NOT NULL,
    stream_id text NOT NULL,
    generation integer NOT NULL CHECK (generation > 0),
    status text NOT NULL CHECK (status IN ('current','draining_closed','reset_required','retired')),
    last_durably_admitted_sequence numeric(78,0) NOT NULL DEFAULT 0 CHECK (last_durably_admitted_sequence >= 0),
    last_processed_sequence numeric(78,0) NOT NULL DEFAULT 0 CHECK (last_processed_sequence >= 0),
    last_replayable_sequence numeric(78,0),
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_json) = 'object' AND octet_length(metadata_json::text) <= 262144),
    lock_version bigint NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CHECK (last_processed_sequence <= last_durably_admitted_sequence),
    UNIQUE (provider_id, stream_id, generation)
);

CREATE UNIQUE INDEX business_event_subscription_current_idx
ON public.business_event_subscription(provider_id)
WHERE status = 'current';

CREATE TABLE public.business_event_continuity (
    continuity_id text PRIMARY KEY,
    subscription_id text NOT NULL REFERENCES public.business_event_subscription(subscription_id),
    previous_stream_id text NOT NULL,
    new_stream_id text NOT NULL,
    reason_code text NOT NULL CHECK (reason_code IN ('SOURCE_CURSOR_EXPIRED','SOURCE_STREAM_RESET','SOURCE_DATA_LOSS','SOURCE_SEQUENCE_REGRESSION','SOURCE_IDENTITY_CONFLICT','SOURCE_POISON_EVENT','TASK_MAPPING_FAILED','SOURCE_ROSTER_CHANGED','OPERATOR_ROTATION')),
    affected_source_ids_json jsonb NOT NULL CHECK (jsonb_typeof(affected_source_ids_json) = 'array' AND jsonb_array_length(affected_source_ids_json) BETWEEN 1 AND 16),
    gap_detected_at timestamptz NOT NULL,
    last_replayable_sequence numeric(78,0) NOT NULL CHECK (last_replayable_sequence >= 0),
    last_continuous_sequence numeric(78,0),
    created_at timestamptz NOT NULL,
    CHECK (previous_stream_id <> new_stream_id),
    UNIQUE (subscription_id, previous_stream_id, new_stream_id, reason_code, last_replayable_sequence)
);

CREATE TABLE public.business_event_inbox (
    inbox_id text PRIMARY KEY,
    subscription_id text NOT NULL REFERENCES public.business_event_subscription(subscription_id),
    event_id text NOT NULL,
    sequence numeric(78,0) NOT NULL CHECK (sequence >= 0),
    envelope_hash text NOT NULL CHECK (envelope_hash ~ '^sha256:[0-9a-f]{64}$'),
    envelope_json jsonb NOT NULL CHECK (jsonb_typeof(envelope_json) = 'object' AND octet_length(envelope_json::text) <= 262144),
    status text NOT NULL CHECK (status IN ('admitted','processing','processed','retryable_failed','terminal_failed')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    admitted_at timestamptz NOT NULL,
    processed_at timestamptz,
    error_code text,
    UNIQUE (subscription_id, event_id),
    UNIQUE (subscription_id, sequence)
);

CREATE TABLE public.event_relation_projection (
    relation_projection_id text PRIMARY KEY,
    inbox_id text NOT NULL REFERENCES public.business_event_inbox(inbox_id),
    status text NOT NULL CHECK (status IN ('complete','incomplete','expired','authorization_mismatch','stream_reset')),
    relation_hash text NOT NULL CHECK (relation_hash ~ '^sha256:[0-9a-f]{64}$'),
    relation_json jsonb NOT NULL CHECK (jsonb_typeof(relation_json) = 'object' AND octet_length(relation_json::text) <= 262144),
    created_at timestamptz NOT NULL,
    UNIQUE (inbox_id, relation_hash)
);

CREATE TABLE public.event_impact_assessment (
    assessment_id text PRIMARY KEY,
    inbox_id text NOT NULL REFERENCES public.business_event_inbox(inbox_id),
    classification text NOT NULL CHECK (classification IN ('none','current_task_goal','current_skill_goal','future_dependency','user_criterion','evidence_invalidated','plan_assumption_invalidated','continuity_unknown','cross_goal_incident')),
    confidence text NOT NULL CHECK (confidence IN ('high','medium','low')),
    goal_id text REFERENCES public.goal(goal_id),
    plan_id text REFERENCES public.user_goal_plan(plan_id),
    skill_goal_id text REFERENCES public.skill_goal(skill_goal_id),
    action text NOT NULL CHECK (action IN ('record_only','reconcile_remote_task','pause_attempt','cancel_attempt','insert_event_handling_skill_goal','revise_user_goal_plan','create_incident_task','request_confirmation','request_input')),
    assessment_json jsonb NOT NULL CHECK (jsonb_typeof(assessment_json) = 'object' AND octet_length(assessment_json::text) <= 262144),
    created_at timestamptz NOT NULL,
    CHECK (NOT (confidence = 'low' AND classification = 'none')),
    UNIQUE (inbox_id)
);

CREATE TABLE public.event_incident (
    incident_id text PRIMARY KEY,
    provider_id text NOT NULL,
    stream_id text NOT NULL,
    dedupe_key text NOT NULL UNIQUE,
    incident_kind text NOT NULL CHECK (incident_kind IN ('continuity_loss','cross_goal','contract_violation')),
    agent_task_id text REFERENCES public.agent_task(task_id),
    incident_json jsonb NOT NULL CHECK (jsonb_typeof(incident_json) = 'object' AND octet_length(incident_json::text) <= 262144),
    created_at timestamptz NOT NULL
);

ALTER TABLE public.workflow_plan
    ADD COLUMN skill_goal_id text REFERENCES public.skill_goal(skill_goal_id),
    ADD COLUMN skill_attempt_id text REFERENCES public.skill_attempt(attempt_id),
    ADD CONSTRAINT workflow_plan_skill_goal_attempt_pair_check
      CHECK ((skill_goal_id IS NULL) = (skill_attempt_id IS NULL));

ALTER TABLE public.workflow_plan_attempt
    ADD COLUMN skill_goal_id text REFERENCES public.skill_goal(skill_goal_id),
    ADD COLUMN skill_attempt_id text REFERENCES public.skill_attempt(attempt_id),
    ADD CONSTRAINT workflow_plan_attempt_skill_goal_attempt_pair_check
      CHECK ((skill_goal_id IS NULL) = (skill_attempt_id IS NULL));

ALTER TABLE public.workflow_instance
    ADD COLUMN skill_goal_id text REFERENCES public.skill_goal(skill_goal_id),
    ADD COLUMN skill_attempt_id text REFERENCES public.skill_attempt(attempt_id),
    ADD CONSTRAINT workflow_instance_skill_goal_attempt_pair_check
      CHECK ((skill_goal_id IS NULL) = (skill_attempt_id IS NULL));

ALTER TABLE public.remote_task_binding
    ADD COLUMN skill_goal_id text REFERENCES public.skill_goal(skill_goal_id),
    ADD COLUMN skill_attempt_id text REFERENCES public.skill_attempt(attempt_id),
    ADD CONSTRAINT remote_task_binding_skill_goal_attempt_pair_check
      CHECK ((skill_goal_id IS NULL) = (skill_attempt_id IS NULL));

INSERT INTO public.schema_migration(version)
VALUES ('v1.2.2_clean_slate_baseline');

SET search_path = public;

-- SDAR v1.2.2 baseline complete
--
