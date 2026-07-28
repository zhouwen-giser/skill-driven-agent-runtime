# Replay Dataset Contract

## Authority

`ArtifactReplayCase` and `ReplayDatasetManifest` V1.1 are immutable validation facts. PostgreSQL owns Cases, Dataset versions, membership, retention state and promotion eligibility. Redis may carry only a wake containing `validationRunId`.

## Snapshot source

A Case is derived only from a frozen `GoalExperienceEpisode` and its linked `ExperienceTrace`. The Episode must preserve the Goal Contract, accepted Plan revision, capability-catalog/readiness snapshot, parameters, policy decision, execution facts and terminal outcome. Catalog membership and readiness are read only from `capabilityCatalogSnapshot`; policy authority is read only from `policyDecisionSnapshot`. Plans, Skill Goals, Attempts and successful outcomes may not fabricate those authorities. A missing authoritative ref excludes the source instead of allowing current mutable runtime state to fill history.

## Split policy

The builder creates the four named purposes:

- `discovery`
- `candidate_development`
- `promotion_holdout`
- `counterexample`

Grouping is transitive and indivisible across Goal lineage, Episode and revision, accepted Plan revision, outcome, exact request, near duplicate and synthetic seed. Environment, Device and five-minute Time Window are three independent isolation axes: equality on any one axis keeps the Cases in one connected split component. Candidate source traces and incomplete snapshots cannot enter `promotion_holdout`. Promotion holdout requires at least three independent groups.

## Deletion and retention

Removing a source Case, including an `ON DELETE CASCADE` from its source Episode, invalidates every affected Dataset and Validation Run for promotion. The PostgreSQL trigger creates a new immutable Dataset version containing only retained Case references before the Case is removed. Completed Result, Failure and Counterexample facts remain immutable audit evidence. The successor remains non-promotable until a full split and leakage check is rebuilt.

## Safety

Replay operations run only under `executionMode=replay` and the dedicated replay queue namespace. Any credential, network, MCP, Provider, device, external write, formal write or remote-task-control attempt is denied before a physical adapter boundary and becomes a critical `ArtifactValidationFailure`, an `ArtifactCounterexample`, an unsafe `ArtifactValidationResult`, and `artifact.validation_completed`.
