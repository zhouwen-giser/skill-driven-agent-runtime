# OSS Intake: AutoSkill / identity and promotion behavior

- Official repository: `ECNU-ICALK/AutoSkill`
- Package/module: management and SkillEvo behavior
- Exact tag/commit/version: `94c47ca488d4ba4117d20272e66d49b9877e68cf`
- License and NOTICE: unconfirmed; README has an MIT badge, but the pinned root has no LICENSE or NOTICE
- Requested use: design/algorithm behavior reference only
- Files or APIs inspected: task-package locked management, runner, replay, eval and mutator paths
- Capability needed: conservative identity, lineage, replay split and promotion metrics
- Why current authoritative components cannot provide it: v1.2.2 Skill Evolution is Skill-specific and cannot own v1.2.3 knowledge targets
- Boundary/adapter: clean-room TypeScript behind SDAR Ports; no Python or file authority
- Maintenance and upgrade plan: source and long-prompt copying remain prohibited until license is confirmed
- Security/quality findings: automatic Skill publication and single-source promotion contradict frozen SDAR policy
- License obligations: no copied material while license is unconfirmed
- Decision and ADR: behavior reference only; ADR-112
