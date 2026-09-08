# ADR-153: GOWM-owned shared business storage

Status: Accepted (user-authorized integration task, 2026-09-08)

## Context

The task package requires normal SDAR runtime data in one existing GOWM database under fixed `ugv_sdar`, with explicit device ownership. GOWM already owns installation and same-device constraints; replaying SDAR's standalone migrations would violate that ownership. Node Control remains a separate management database.

## Decision

Use one explicitly configured business Pool with fixed options on every connection. Shared startup performs read-only validation; standalone migration code is unreachable in that mode. `GOWM_DATABASE_URL` takes precedence over `SDAR_POSTGRES_URL` for every runtime repository, without fallback. Reject URL `options` overrides.

Domain owns immutable DeviceTaskContext and DeviceWorkScope. Application resolves before Task creation and restores from the saved binding for follow-up and background work. PostgreSQL adapters own catalog reads, scoped SQL, targets and canonical association. No global mutable current device, additional execution engine or business export copy is introduced.

Device tasks, scoped claims and subscription generations use the final GOWM keys. Non-device tasks are an explicitly enabled independent channel. Shared Goal/Skill definitions remain reusable. The same transaction client owns native writes and target relationships; remote operations remain outside transactions. Missing canonical parents remain nullable and are resolved only with matching device/service evidence, never fabricated.

## Contract reuse

GOWM is an MIT-licensed SQL/API contract reference, not a new runtime dependency. Exact commit, selected unmodified DDL references, license, installer hashes and consumer metadata are recorded in `contracts/gowm-shared-storage/current`. SDAR never executes the reference DDL. No sibling source import is introduced.

## Validation and consequences

All task-package required scenarios remain mandatory, including normal Server dual-device PostgreSQL execution against a synthetic Frozen MCP peer. Current implementation is incremental; this ADR is a design decision, not a completion claim. No changes to GOWM/SMPP, user deployment, existing history or old databases are authorized by this implementation.

## Target consumer representation (2026-09-08)

Pinned GOWM PLAN_NODE ownership checks nodes[].id, while the native SDAR DSL uses nodeId. The shared-storage serializer adds an equal id alias without changing native fields. Every persisted-plan/hash reader removes verified dual-field aliases; a mismatched pair is an explicit storage error. Legacy id-only governance records remain unchanged. External DSL validation and LangGraph never receive a generated alias, and existing continuation snapshots/hashes are not rewritten.

Spatial fields are declared through the validated x-sdar-targets JSON Schema annotation, with exact JSON pointer, purpose, format and an explicit CRS value or input pointer. No arbitrary coordinate scan or model regeneration occurs. Only EPSG:4326 produces a WGS84 geometry; local frames retain native geometry. Unresolved CRS produces a persistent diagnostic. The target writer receives the business transaction client, validates Task lineage plus GOWM's exact owner trigger, serializes identical owner/path writes with a transaction advisory lock, and creates no geometry on an identical replay. A conflicting exact owner fails, while a new Plan owns a new target. This is a narrow adapter to the MIT-pinned SQL contract, not a copied repository or installation owner.

## Canonical link and recovery ownership (2026-09-08)

The shared consumer remains SELECT-only on SMPP provider_task. Do not use a parent row-lock mode requiring UPDATE grants. Recheck the complete native parent identity in the SDAR canonical UPDATE, retain GOWM's unchanged trigger, and leave absent/unverifiable/conflicting parents nullable with persistent diagnostics. UUID syntax alone is insufficient; require persisted receipt, discovery, frozen device/service binding, provider, operation and execution context evidence. Canonical metadata does not increment the Runtime version or cause another MCP call.

Admission intents lack a native device column, so their Task owns filtering, including fallback SELECTs after unsuccessful CAS. Process-loss recovery uses the same configured Task/Plan scope for Task, Instance and Attempt updates. Explicit non-device execution cannot access directory-bound device MCP servers. Other worker/retention scopes remain a required implementation item, not an implied consequence of these adapters.

## Pinned Task input source representation (2026-09-08)

The pinned ugv_sdar.task_input_request source CHECK excludes remote_task, despite SDAR's standalone Domain supporting it. A remote input is a workflow input with a native remote_task_input_link. In shared mode the existing atomic activation writes source=workflow and the exact link together; read/answer/attempt projections restore remote_task only when that link and its binding identify the same Task. Ordinary workflow inputs remain workflow. Reject separate remote_task request creation that cannot atomically establish this relation. No native constraint, old record, external source identity or lifecycle is rewritten, and no extra source-of-truth table is created. This adapter representation is explicit rather than relying on an impossible shared-table enum value.

## Continuation persistence boundary (2026-09-08)

Continuation ownership follows the persisted Task/Plan/Instance/Control, including shared allowlists containing multiple devices. Remote waits additionally match their Task and exact node run; an attempt must refer to an actual snapshot wait binding. Apply the same scope to inbox claims, lifecycle transitions and attempt projections. Idempotency uses existing canonical content hashing because JSON property order is not semantic identity. Do not rewrite old snapshots or persisted hashes, and do not infer that repository verification proves checkpoint replay correctness.

## Admitted Tool Schema provenance (2026-09-08)

Capture the exact operation name and bounded, deeply frozen input Schema in the existing Remote authority snapshot before dispatch. Persist it through the existing receipt/authority JSON, not a new GOWM column or a shadow catalog. Shared DISPATCHED target extraction reads this snapshot plus actual persisted arguments; it must not read the current mutable mcp_tool directory. Historical snapshots remain readable and unchanged. A new shared admission lacking the frozen Schema fails explicitly and atomically rather than reconstructing provenance from today's catalog. Normal authority-drift checks remain in force; this change does not authorize replay of an old invocation.

## Synchronous target representation boundary (2026-09-08)

The task package and pinned validate_target_owner explicitly require a real Remote Binding for a NODE_RUN owner. A synchronous MCP invocation therefore retains its exact arguments and the real TASK/PLAN_NODE targets without inventing a Remote Binding or DISPATCHED association. Normal local-Point synchronous and remote tests now verify this boundary through the GOWM target read model. This is a contract limit, not an additional execution state or a reason to reject legitimate synchronous work.


## Goal 复用时的效果和判定来源（2026-09-08）

共享 Goal/Plan 定义不承担其第一个设备消费者的身份。新增 OutcomeDecision / CompletedEffect.executionTaskId 作为可选 Domain 来源字段，由共享模式正式 UserGoalPlanController 的持久 Task 上下文提供，保存在既有 JSON 中，不更改 GOWM DDL。读取设备判定/效果时解析实际来源 Task，再比较 device_id 与 sdar_service_key；特定 Task 的 Evidence 投影只使用该 Task 产生的事实。同一设备的其他 Task 结果仍可用于共同 Goal 判定。

设备效果指纹使用 schemaVersion 2.0，并纳入稳定 deviceId，避免同一 Goal/effectRef 在另一台设备执行被误判为重放；同一设备的指纹仍稳定。无设备上下文保留原 1.0 算法。已有 JSON、指纹和报告不改写；共享模式不把缺少来源的旧判定/效果推定为当前设备事实。历史转换和进度向量的范围仍属于未关闭工作，禁止从 START 重放来补来源。


恢复进度沿用 JSON 承载 executionTaskId，不新增或修改上游表。进度和恢复决策必须同源；按实际 Task 设备/服务读取最新进度。旧无来源进度若不早于可验证进度，不能当作空历史启动恢复，必须返回 RECOVERY_PROGRESS_SOURCE_UNPROVEN。Standalone 保留旧模型兼容。

普通子工作流复用确认定义时创建独立 Task 执行计划，使用现有 sourceConfirmedPlanId 指向原计划，定义内容保持不变；不向共享模板补设备。共享定义可被设备范围内请求检索，实例执行仍须使用当前 Task 的计划，父子关联在原事务验证同源。

Evidence recovery 使用现有 target JSON 的 deviceScopeHash 保存发起时的设备范围身份；设备集合排序与去重后计算摘要。范围变化不得自动接管旧请求，旧无摘要记录保持历史并显式拒绝恢复。该字段属于持久恢复上下文，不引入另一套任务状态机。
