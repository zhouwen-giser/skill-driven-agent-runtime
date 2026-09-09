interface ExpectedSkill {
  skillId: string;
  capabilityId: string;
}
interface Capability {
  capabilityId: string;
  version: number;
  status: string;
}
interface Exposure {
  exposureId: string;
  version: number;
  exposureHash: string;
  capabilityId: string;
  capabilityVersion: number;
  status: string;
  visibility: string;
  agentSkillId: string;
}
interface Profile {
  entries?: {
    capabilityId: string;
    capabilityVersion: number;
    agentSkillId: string;
    exposureId: string;
    exposureVersion: number;
    exposureHash: string;
  }[];
  version?: string;
}
export function verifyPublishedInventory(
  manifest: { skills: ExpectedSkill[] },
  inventory: {
    skills: { skillId: string; status: string }[];
    capabilities: Capability[];
    exposures: Exposure[];
    card: {
      skills?: { id: string }[];
      capabilities?: { extensions?: { uri: string; params?: Profile }[] };
    };
  },
): {
  blocked: { skillId?: string; capabilityId?: string; reasonCode: string }[];
  expectedSkills: string[];
  publicSkillIds: string[];
  publicCapabilityIds: string[];
  catalogVersion?: string;
};
