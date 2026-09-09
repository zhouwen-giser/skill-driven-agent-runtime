CREATE VIEW gowm_business_v1.device_catalog AS SELECT device_id,data_scope_key,identifier_namespace,device_identifier,device_name,device_type,enabled FROM gowm_device.device OFFSET 0;
CREATE VIEW gowm_business_v1.device_ingest_routes AS SELECT device_id,stream_id,data_scope_key,endpoint_id,topic_filter,identity_mode,identity_rule,datastream_key,enabled FROM gowm_device.device_stream OFFSET 0;
CREATE VIEW gowm_business_v1.device_service_bindings AS SELECT * FROM gowm_device.device_service_binding OFFSET 0;
CREATE VIEW gowm_business_v1.sdar_tasks AS SELECT device_id,task_id,gowm_binding_id,sdar_service_key,phase,phase_message,plan_id,goal_id,goal_version,created_at,updated_at FROM ugv_sdar.agent_task WHERE device_id IS NOT NULL OFFSET 0;
CREATE VIEW gowm_business_v1.workflow_steps AS
 SELECT p.device_id,p.gowm_task_id AS task_id,p.plan_id,p.definition_json,w.instance_id,e.event_id,e.sequence,e.node_id,e.event_type,
 NULL::text AS workflow_node_run_id,NULL::text AS binding_id,NULL::text AS mcp_invocation_id,'NATIVE_EVENT'::text AS record_kind
 FROM ugv_sdar.workflow_plan p LEFT JOIN ugv_sdar.workflow_instance w ON w.plan_id=p.plan_id AND w.device_id=p.device_id
 LEFT JOIN ugv_sdar.workflow_node_event e ON e.instance_id=w.instance_id AND e.device_id=p.device_id WHERE p.device_id IS NOT NULL
 UNION ALL
 SELECT r.device_id,r.agent_task_id,r.workflow_plan_id,p.definition_json,r.workflow_instance_id,NULL,NULL,r.workflow_node_id,NULL,
 r.workflow_node_run_id,r.binding_id,r.mcp_invocation_id,'REMOTE_NODE_RUN'
 FROM ugv_sdar.remote_task_binding r JOIN ugv_sdar.workflow_plan p ON p.plan_id=r.workflow_plan_id AND p.device_id=r.device_id WHERE r.device_id IS NOT NULL;
CREATE VIEW gowm_business_v1.mcp_tasks AS SELECT device_id,task_id,gowm_binding_id,smpp_service_key,provider_id,operation_name,arguments,result,error,internal_state,mcp_status,external_execution_id,created_at,updated_at FROM ugv_smpp.provider_task OFFSET 0;
CREATE VIEW gowm_business_v1.provider_executions AS SELECT device_id,task_id,mcp_task_id,gowm_binding_id,smpp_service_key,external_execution_id,operation_name,execution_context,payload,result,state,downstream_mission_ids FROM ugv_smpp.ugv_execution OFFSET 0;
CREATE VIEW gowm_business_v1.provider_dispatches AS SELECT * FROM ugv_smpp.ugv_mutation_journal OFFSET 0;
CREATE VIEW gowm_business_v1.mission_links AS SELECT * FROM gowm_execution.execution_mission_link OFFSET 0;
CREATE VIEW gowm_business_v1.task_target_geometries AS SELECT b.*,g.target_group_id,g.revision,g.native_geometry,g.native_crs,g.geometry_wgs84,g.normalization_state FROM gowm_task.target_binding b JOIN gowm_task.target_geometry g USING(target_id,data_scope_key);
CREATE VIEW gowm_business_v1.task_execution_lineage AS
 SELECT t.device_id,t.task_id AS sdar_task_id,t.phase AS sdar_phase,p.plan_id,w.instance_id AS workflow_instance_id,
 r.workflow_node_id,r.workflow_node_run_id,r.binding_id AS remote_binding_id,r.mcp_invocation_id,
 r.smpp_service_key,m.task_id AS mcp_task_id,m.mcp_status,e.task_id AS provider_task_record_id,e.external_execution_id,e.state AS provider_state,
 d.step_id AS dispatch_step_id,d.state AS dispatch_state,l.link_id,l.mission_instance_id,l.link_state,l.relation_kind,
 CASE WHEN r.binding_id IS NULL THEN 'NO_REMOTE_TASK'
 WHEN m.task_id IS NULL OR e.task_id IS NULL THEN 'PROVIDER_PENDING'
 WHEN l.link_state='CONFLICTED' THEN 'CONFLICTED'
 WHEN l.link_state='LINKED' THEN 'LINKED' ELSE 'MISSION_UNRESOLVED' END AS missing_stage
 FROM ugv_sdar.agent_task t
 LEFT JOIN ugv_sdar.workflow_plan p ON p.gowm_task_id=t.task_id AND p.device_id=t.device_id
 LEFT JOIN ugv_sdar.workflow_instance w ON w.plan_id=p.plan_id AND w.device_id=t.device_id
 LEFT JOIN ugv_sdar.remote_task_binding r ON r.agent_task_id=t.task_id AND r.device_id=t.device_id AND r.workflow_instance_id=w.instance_id
 LEFT JOIN ugv_smpp.provider_task m ON m.task_id=r.canonical_mcp_task_id AND m.device_id=t.device_id AND m.smpp_service_key=r.smpp_service_key
 LEFT JOIN ugv_smpp.ugv_execution e ON e.mcp_task_id=m.task_id AND e.device_id=t.device_id AND e.smpp_service_key=m.smpp_service_key
 LEFT JOIN ugv_smpp.ugv_mutation_journal d ON d.task_id=e.task_id AND d.device_id=t.device_id
 LEFT JOIN gowm_execution.execution_mission_link l ON l.provider_task_record_id=e.task_id AND l.provider_dispatch_step_id=d.step_id AND l.device_id=t.device_id
 WHERE t.device_id IS NOT NULL;
