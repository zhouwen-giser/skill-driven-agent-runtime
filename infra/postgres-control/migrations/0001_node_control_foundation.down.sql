DROP TRIGGER IF EXISTS control_audit_event_immutable ON sdar_control.control_audit_event;
DROP FUNCTION IF EXISTS sdar_control.reject_audit_mutation();
DROP TABLE IF EXISTS sdar_control.control_audit_event;
DROP TABLE IF EXISTS sdar_control.management_operation;
DROP TABLE IF EXISTS sdar_control.node_profile;
