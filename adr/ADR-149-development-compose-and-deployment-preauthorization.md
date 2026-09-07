# ADR-149 — Development Compose and deployment preauthorization

Status: Accepted for the user-approved Development package (2026-09-07).

## Context

Host launch procedures depended on manually synchronized credentials and historical point
navigation authority. Development public access and automatic non-weapon confirmation are explicit
user choices, not qualification or production policies.

## Decision

- One Runtime/Management/Console process, Control API/worker, separate Runtime and Control PostgreSQL
  authorities and Redis AOF belong to one Compose project. External systems are not deployed here.
- Generate persistent private credentials/master key once. Internal identities remain authenticated
  despite public anonymous access. Parse dotenv as data, with CLI > process > file > defaults.
- Persist Task/Plan/Capability binding before the existing confirmation service automatically
  confirms known non-weapon UGV plans. Record the deployment owner's `deployment_preauthorized`
  authority, not a fabricated interactive event. Do not rewrite Skill policy or self-send A2A messages.
- Empty installations may create point Capability v1. Version number alone cannot substitute for
  actual binding/constraints; incompatible historical definitions still fail their contracts.
- Do not enable Device weapon/effector execution. An inert software indicator demo has manual
  acknowledgement and append-only audit, no targeting, transport, Task, Mission or physical-success
  contract. It is not an executable A2A/MCP capability and cannot authorize a Device implementation.
- Upgrade retains volumes and rejects observed active Tasks, remote work, pending dispatch,
  governance operations and Bull leases. Recheck after build; callers stop new submissions during
  the rolling window. This is not a distributed admission-lock guarantee.

## Consequences and verification

Use a trusted development network, not the public internet. Exposed PG/Redis retain passwords.
Skill visibility is independent from invocation readiness. Unclassified/nested custom plans remain
manual. Missing inputs and dependencies are not fabricated. Idempotency, exact reconciliation and
real terminal checks remain in force.

Migration 0178 adds inert audit; rollback refuses to delete its history. Database identity and master
key changes need explicit migration. Never disable Redis durability to make startup pass.

Only affected configuration, governance, confirmation/recovery, inert demo, necessary compilation and
isolated deployment checks are required here. Shared instances and external devices are untouched;
qualification/production suites remain outside this task.
