export function verifyPublishedInventory(manifest, inventory) {
  const blocked = [];
  const catalog = inventory.card.capabilities?.extensions?.find(
    (item) => item.uri === 'io.sdar/capabilityExposureCatalog',
  )?.params;
  const publicCapabilities = catalog?.entries ?? [];
  const publicSkillIds = new Set((inventory.card.skills ?? []).map((item) => item.id));
  for (const expected of manifest.skills) {
    const skill = inventory.skills.find(
      (item) => item.skillId === expected.skillId && item.status === 'enabled',
    );
    if (!skill) blocked.push({ skillId: expected.skillId, reasonCode: 'SKILL_NOT_ENABLED' });
    const capability = inventory.capabilities
      .filter((item) => item.capabilityId === expected.capabilityId && item.status === 'published')
      .sort((a, b) => b.version - a.version)[0];
    if (!capability) {
      blocked.push({ capabilityId: expected.capabilityId, reasonCode: 'CAPABILITY_NOT_PUBLISHED' });
      continue;
    }
    const exposure = inventory.exposures.find(
      (item) =>
        item.capabilityId === capability.capabilityId &&
        item.capabilityVersion === capability.version &&
        item.status === 'published' &&
        item.visibility === 'public',
    );
    if (!exposure || !publicSkillIds.has(exposure.agentSkillId))
      blocked.push({ capabilityId: expected.capabilityId, reasonCode: 'PUBLIC_SKILL_MISSING' });
    if (
      !publicCapabilities.some(
        (item) =>
          item.capabilityId === capability.capabilityId &&
          item.capabilityVersion === capability.version &&
          item.agentSkillId === exposure?.agentSkillId &&
          item.exposureId === exposure?.exposureId &&
          item.exposureVersion === exposure?.version &&
          item.exposureHash === exposure?.exposureHash,
      )
    )
      blocked.push({
        capabilityId: expected.capabilityId,
        reasonCode: 'PUBLIC_CAPABILITY_MISSING',
      });
  }
  if (!publicSkillIds.size || !publicCapabilities.length)
    blocked.push({ reasonCode: 'AGENT_CARD_EMPTY' });
  if (publicCapabilities.some((item) => item.capabilityId === 'vehicle.ugv.fire-weapon'))
    blocked.push({ reasonCode: 'DEVICE_WEAPON_PUBLICATION_FORBIDDEN' });
  return {
    blocked,
    expectedSkills: manifest.skills.map((item) => item.skillId),
    publicSkillIds: [...publicSkillIds],
    publicCapabilityIds: publicCapabilities.map((item) => item.capabilityId),
    catalogVersion: catalog?.version,
  };
}
