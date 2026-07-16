# v1.0.5 Implementation

Date: 2026-07-16

ADR-076 introduces one conservative transitive confirmation evaluator for initial Task plans, outer replans and child Skill plans. A child that opts out persists exact parent plan/instance/node, child plan, Skill version and confirmation lifecycle before LangGraph emits a typed pause. Parent confirmation never grants child authority.

Migration 0057 permits pending linkage before the deterministic child instance materializes while preserving the final child-instance foreign key. The Task projects the pause as A2A input-required and resumes the same immutable parent node only after an independent child decision.

Feature commit/tag: `6decc5d` / `v1.0.5`.
