ALTER TABLE ugv_sdar.agent_task ADD device_id text REFERENCES gowm_device.device, ADD gowm_binding_id uuid,
 ADD sdar_service_key text, ADD UNIQUE(device_id,task_id),
 ADD CHECK((device_id IS NULL AND gowm_binding_id IS NULL AND sdar_service_key IS NULL) OR (device_id IS NOT NULL AND gowm_binding_id IS NOT NULL AND sdar_service_key IS NOT NULL)),
 ADD FOREIGN KEY(device_id,gowm_binding_id) REFERENCES gowm_device.device_service_binding(device_id,binding_id);
ALTER TABLE ugv_sdar.workflow_plan ADD device_id text REFERENCES gowm_device.device, ADD gowm_task_id text,
 ADD UNIQUE(device_id,plan_id), ADD FOREIGN KEY(device_id,gowm_task_id) REFERENCES ugv_sdar.agent_task(device_id,task_id),
 ADD CHECK((device_id IS NULL)=(gowm_task_id IS NULL));
ALTER TABLE ugv_sdar.workflow_instance ADD device_id text REFERENCES gowm_device.device,
 ADD UNIQUE(device_id,instance_id), ADD FOREIGN KEY(device_id,plan_id) REFERENCES ugv_sdar.workflow_plan(device_id,plan_id);
ALTER TABLE ugv_sdar.workflow_node_event ADD device_id text REFERENCES gowm_device.device,
 ADD FOREIGN KEY(device_id,instance_id) REFERENCES ugv_sdar.workflow_instance(device_id,instance_id);
ALTER TABLE ugv_sdar.mcp_invocation ADD device_id text REFERENCES gowm_device.device,
 ADD UNIQUE(device_id,invocation_id), ADD FOREIGN KEY(device_id,task_id) REFERENCES ugv_sdar.agent_task(device_id,task_id);
ALTER TABLE ugv_sdar.remote_task_binding ADD device_id text REFERENCES gowm_device.device,
 ADD smpp_service_key text, ADD canonical_mcp_task_id uuid,
 ADD UNIQUE(device_id,binding_id),
 ADD FOREIGN KEY(device_id,agent_task_id) REFERENCES ugv_sdar.agent_task(device_id,task_id),
 ADD FOREIGN KEY(device_id,workflow_instance_id) REFERENCES ugv_sdar.workflow_instance(device_id,instance_id),
 ADD FOREIGN KEY(device_id,mcp_invocation_id) REFERENCES ugv_sdar.mcp_invocation(device_id,invocation_id),
 ADD CHECK(device_id IS NULL OR smpp_service_key IS NOT NULL);
-- Canonical MCP identity may be unresolved before the other service commits.
-- Resolution validates same device and stable service in the repository transaction.
CREATE INDEX sdar_device_task_list ON ugv_sdar.agent_task(device_id,created_at,task_id);
CREATE INDEX sdar_device_remote_claim ON ugv_sdar.remote_task_binding(device_id,next_poll_at,binding_id);
