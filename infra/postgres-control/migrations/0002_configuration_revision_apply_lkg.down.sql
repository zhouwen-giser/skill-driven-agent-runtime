DROP TRIGGER IF EXISTS configuration_published_content_immutable ON sdar_control.configuration_revision;
DROP FUNCTION IF EXISTS sdar_control.protect_published_configuration_content();
DROP TABLE IF EXISTS sdar_control.configuration_command_receipt;
DROP TABLE IF EXISTS sdar_control.configuration_target_state;
DROP TABLE IF EXISTS sdar_control.configuration_application;
DROP TABLE IF EXISTS sdar_control.configuration_revision;
