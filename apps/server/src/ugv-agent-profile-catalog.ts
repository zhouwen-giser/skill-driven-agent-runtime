export const UGV_RESOURCE_ID = 'vehicle:ugv1' as const;

export type UgvReviewedToolName =
  | 'vehicle_get_state'
  | 'vehicle_get_capabilities'
  | 'vehicle_get_payload_status'
  | 'vehicle_get_targets'
  | 'vehicle_navigate'
  | 'vehicle_area_recon'
  | 'vehicle_track_target'
  | 'vehicle_control_gimbal'
  | 'vehicle_emergency_stop'
  | 'vehicle_fire_weapon';

export interface UgvAgentCapabilityDeclaration {
  readonly toolName: UgvReviewedToolName;
  readonly skillId: string;
  readonly capabilityId: string;
  readonly exposureId: string;
  readonly taskTypeId: string;
  readonly title: string;
  readonly recognitionHints: readonly string[];
  readonly kind: 'read_only' | 'physical_control' | 'emergency_stop' | 'weapon_control';
  readonly missionType?: 'point' | 'route' | 'distance' | 'return_home';
  readonly confirmation: 'none' | 'physical' | 'direct_emergency_or_physical' | 'weapon';
}

export const UGV_AGENT_CAPABILITY_CATALOG: readonly UgvAgentCapabilityDeclaration[] = Object.freeze(
  [
    declaration(
      'vehicle_get_state',
      'ugv.get-state',
      'vehicle.ugv.read-state',
      'read-state',
      'Read UGV state',
      ['无人车状态', '车辆状态', 'UGV state'],
      'read_only',
      'none',
    ),
    declaration(
      'vehicle_get_capabilities',
      'ugv.get-capabilities',
      'vehicle.ugv.read-capabilities',
      'read-capabilities',
      'Read UGV capabilities',
      ['无人车能力', '车辆能力', 'UGV capabilities'],
      'read_only',
      'none',
    ),
    declaration(
      'vehicle_get_payload_status',
      'ugv.get-payload-status',
      'vehicle.ugv.read-payload',
      'read-payload',
      'Read UGV payload status',
      ['无人车载荷状态', '车辆载荷状态', 'UGV payload status'],
      'read_only',
      'none',
    ),
    declaration(
      'vehicle_get_targets',
      'ugv.get-targets',
      'vehicle.ugv.read-targets',
      'read-targets',
      'Read UGV targets',
      ['无人车目标列表', '车辆目标列表', 'UGV targets'],
      'read_only',
      'none',
    ),
    Object.freeze({
      toolName: 'vehicle_navigate',
      skillId: 'embodied.move_to',
      capabilityId: 'embodied.move',
      exposureId: 'a2a.embodied.move',
      taskTypeId: 'task-type.ugv-point-navigation',
      title: 'Move the governed UGV to one WGS84 point',
      recognitionHints: Object.freeze([
        '无人车移动到目标点',
        '无人车点导航',
        'UGV point navigation',
      ]),
      kind: 'physical_control',
      missionType: 'point',
      confirmation: 'physical',
    }),
    navigation(
      'ugv.navigate-route',
      'vehicle.ugv.navigate-route',
      'navigate-route',
      'route',
      'Navigate the UGV through an ordered route',
      ['无人车路线导航', '多航点导航', 'UGV route navigation'],
    ),
    navigation(
      'ugv.navigate-distance',
      'vehicle.ugv.navigate-distance',
      'navigate-distance',
      'distance',
      'Move the UGV by a relative distance',
      ['无人车按距离移动', '向前移动', 'UGV distance movement'],
    ),
    navigation(
      'ugv.return-home',
      'vehicle.ugv.return-home',
      'return-home',
      'return_home',
      'Return the UGV to its governed home',
      ['无人车返航', '车辆返回起点', 'UGV return home'],
    ),
    declaration(
      'vehicle_area_recon',
      'ugv.area-recon',
      'vehicle.ugv.recon',
      'recon',
      'Run UGV area reconnaissance',
      ['无人车区域侦察', '车辆侦察', 'UGV recon'],
      'physical_control',
      'physical',
    ),
    declaration(
      'vehicle_track_target',
      'ugv.track-target',
      'vehicle.ugv.track-target',
      'track-target',
      'Track a target with the UGV',
      ['无人车跟踪目标', '车辆追踪目标', 'UGV track target'],
      'physical_control',
      'physical',
    ),
    declaration(
      'vehicle_control_gimbal',
      'ugv.control-gimbal',
      'vehicle.ugv.control-gimbal',
      'control-gimbal',
      'Control the UGV gimbal',
      ['无人车控制云台', '车辆云台', 'UGV gimbal'],
      'physical_control',
      'physical',
    ),
    declaration(
      'vehicle_emergency_stop',
      'ugv.emergency-stop',
      'vehicle.ugv.emergency-stop',
      'emergency-stop',
      'Emergency-stop the UGV',
      ['无人车急停', '车辆紧急停止', 'UGV emergency stop'],
      'emergency_stop',
      'direct_emergency_or_physical',
    ),
    declaration(
      'vehicle_fire_weapon',
      'ugv.fire-weapon',
      'vehicle.ugv.fire-weapon',
      'fire-weapon',
      'Fire one governed UGV weapon cycle',
      ['无人车武器单发', 'UGV fire weapon'],
      'weapon_control',
      'weapon',
    ),
  ],
);

export const UGV_REVIEWED_TOOL_NAMES = Object.freeze(
  [...new Set(UGV_AGENT_CAPABILITY_CATALOG.map(({ toolName }) => toolName))].sort(),
);

export const UGV_PUBLIC_SKILL_IDS = Object.freeze(
  [...new Set(UGV_AGENT_CAPABILITY_CATALOG.map(({ skillId }) => skillId))].sort(),
);

export function ugvCapabilityForSkill(skillId: string): UgvAgentCapabilityDeclaration | undefined {
  return UGV_AGENT_CAPABILITY_CATALOG.find((item) => item.skillId === skillId);
}

export function isHistoricalUgvPointSkill(skillId: string, version: number): boolean {
  return skillId === 'embodied.move_to' && version === 1;
}

function declaration(
  toolName: UgvReviewedToolName,
  skillId: string,
  capabilityId: string,
  suffix: string,
  title: string,
  recognitionHints: readonly string[],
  kind: UgvAgentCapabilityDeclaration['kind'],
  confirmation: UgvAgentCapabilityDeclaration['confirmation'],
): UgvAgentCapabilityDeclaration {
  return Object.freeze({
    toolName,
    skillId,
    capabilityId,
    exposureId: `a2a.vehicle.ugv.${suffix}`,
    taskTypeId: `task-type.vehicle.${suffix}`,
    title,
    recognitionHints: Object.freeze([...recognitionHints]),
    kind,
    confirmation,
  });
}

function navigation(
  skillId: string,
  capabilityId: string,
  suffix: string,
  missionType: 'route' | 'distance' | 'return_home',
  title: string,
  recognitionHints: readonly string[],
): UgvAgentCapabilityDeclaration {
  return Object.freeze({
    ...declaration(
      'vehicle_navigate',
      skillId,
      capabilityId,
      suffix,
      title,
      recognitionHints,
      'physical_control',
      'physical',
    ),
    missionType,
  });
}
