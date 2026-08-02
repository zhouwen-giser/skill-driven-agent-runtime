DROP TRIGGER agent_card_no_delete ON sdar_control.agent_card_revision;
DROP TRIGGER agent_card_content_immutable ON sdar_control.agent_card_revision;
DROP FUNCTION sdar_control.protect_agent_card_content();
DROP TRIGGER a2a_exposure_no_delete ON sdar_control.a2a_exposure_version;
DROP TRIGGER a2a_exposure_content_immutable ON sdar_control.a2a_exposure_version;
DROP FUNCTION sdar_control.protect_a2a_definition_content();
DROP TABLE sdar_control.agent_card_revision;
DROP SEQUENCE IF EXISTS sdar_control.agent_card_revision_sequence;
DROP TABLE sdar_control.a2a_exposure_version;
