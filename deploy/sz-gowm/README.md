# sz-gowm deployment

Use the standard development source archive and its SHA256/manifest. This site consumes existing
GOWM PostgreSQL and existing SMPP; it creates no separate business database container.

1. Preserve GOWM's private business-connections.env and take a local custom-format pg_dump backup.
2. Ensure the existing PostgreSQL image provides the repository-pinned pgvector 0.8.5. The optional
   Dockerfile.pgvector derives from the exact recorded site image. Keep the original image and
   volume, render the original Compose with all profiles and its original private env, and update
   only postgres using a private resolved Compose. Keep that Compose for future recreation.
3. Run configure.mjs with private env path, managed connections path, existing Docker network,
   public host and built SDAR image. It preserves generated passwords and master key.
4. Run prepare-storage.py SITE_DIRECTORY WORLD_API_CONTAINER. This invokes GOWM's official
   installer, grants the consumer's required access and creates a separate Control database in
   the existing PostgreSQL server. It does not rotate GOWM-managed passwords.
5. Configure the official Registry source and provider identities as described below. From source run deploy/development/deploy.sh up --env-file SITE_DIRECTORY/config/.env.
   Then execute `node deploy/sz-gowm/bootstrap.mjs` inside the Runtime container to initialize
   the three baseline singleton policy data rows (existing values are preserved) and register SMPP.
   Verify /api/v1/health, /console/, Agent Card and Control readiness, then register actual MCP
   endpoints through official management APIs and verify discovered tools.

Keep all private env, resolved Compose and database backups outside the source package, mode 0600.
Default initialization uses ugv-agent-profile, non-weapon side effects YES and auto_non_weapon.
Existing explicit operator settings are preserved; migrating a previous manual/off deployment is
an explicit configuration change. Custom/nested plans retain the normal confirmation boundary. A health check or tools/list does not prove model-driven
Task execution. Reverting SDAR means stopping only its Compose project while retaining volumes.
After installing vector into a database, keep the extension-capable PostgreSQL image for recovery;
do not restart that database with an image missing the extension library.

When saving `docker compose config --format json`, retain its existing dollar escaping;
do not escape the complete output a second time. Compare the resulting container healthcheck,
PostgreSQL environment and volume names with the predeployment inspect snapshot.
Private dotenv files use writeConfiguration's single-quoted values so JSON device lists and
literal dollar signs survive Node's parseEnv unchanged.

For an existing SMPP-only GOWM binding, run `attach-device.py SITE_DIRECTORY` for read-only
preflight. With the site's authorization and no active SMPP tasks, `--apply` backs up the current
binding/Compose, uses GOWM's resolveBusinessDeviceContext to create the SDAR-enriched successor,
and reloads the same SMPP images with that binding. Old binding rows are retained. Current
preflight deliberately rejects any existing UGV execution record; broader live migrations need
a separately reviewed task drain policy.


## Official Registry and default governance

Governance bootstrap defaults to YES. Set SDAR_UGV_SOURCE_ID,
SDAR_UGV_REGISTRY_ENDPOINT, SDAR_UGV_REGISTRY_ENVIRONMENT,
SDAR_UGV_EXTERNAL_PROVIDER_ID and SDAR_UGV_EXTERNAL_SERVER_ID from the real PMS Registry.
For the fixed upstream used on sz-gowm, select `SDAR_UGV_CATALOG_PROFILE=ugv-v1-10`;
the older Development eleven-tool contract is `ugv-v1-11` (includes laser range).
Both profiles reject unexpected catalog drift. Keep the Runtime MCP server ID distinct from
PMS instance ID and the GOWM device binding ID.

If PMS is absent, build Dockerfile targets `pms-api` and `pms-worker` from the verified nested
SMPP source in the fixed upstream union. `pms-registry.py SITE --api-image IMAGE
--worker-image IMAGE --postgres-image IMAGE` prepares private configuration for an independent
PMS management PostgreSQL and official API/worker. Start its generated Compose, then execute
`node /run/pms-site/pms-register.mjs` in the API container (copy this helper into SITE first).
It uses official PMS application services/APIs to synchronize packages and register the existing
Provider, resource and direct-container deployment. It does not migrate SMPP business storage.
Enable the existing Runtime's native PMS registration client using the same deployment/instance
identity and generated registration token file. Back up its resolved Compose, verify no active
provider tasks, add the token as a read-only bind mount, and reload only that Runtime with its
original image. Never insert a fabricated Registry snapshot. The worker must publish the real
`/api/v1/registry/development/consumers/sdar/v1/sources/SOURCE_ID/latest` projection.

The shared bootstrap calls Source sync, Provider materialization and formal versioned governance,
then checks `deploy/development/capability-manifest.json` against enabled Skills, published
Capabilities, public Exposures and the activated Agent Card. Missing configuration, failed stages,
missing expected publications or an empty Card return nonzero. The status file is
`/app/development-packages/bootstrap-status.json`. HTTP 200 alone is not deployment acceptance.
Explicit `SDAR_UGV_BOOTSTRAP_ENABLED=NO` is reported as governance disabled.

`embodied.area_patrol` remains blocked until GOWM supplies its required `embodied.inspect_area`
contract and evidence. The native UGV reconnaissance polygon/result is not that contract.
Do not alias it or mark the patrol package enabled to manufacture readiness. This known block
keeps full-manifest acceptance incomplete even when the other supported capabilities are public.
No bootstrap or directory acceptance step invokes a device action.

Recovery: restore the private pre-change environment and resolved Compose plus recorded images;
retain all shared business data, PMS volume and governance history. Use official version switching
for published successors; do not delete history or bulk-enable draft versions. Source unions contain
no offline images, private configuration, registration token, model key or database backup.

## 设备资源身份

GOWM 设备主档 `ugv:ugv` 对应 SMPP resource `vehicle:ugv`、Provider `isr.vehicle.ugv.ugv`。`SDAR_UGV_RESOURCE_ID` 用于治理发布；Runtime 从正式 Exposure、冻结 Task Capability 与当前 Provider Binding 校验身份，不再使用编译期 `UGV_MOVE_RESOURCE_ID`。不要将公开 Card 改回 `vehicle:ugv1` 规避旧镜像缺陷，应更新包含 ADR-155 修复的 SDAR 镜像。旧仿真设备仅在其正式治理合同授权时仍可使用。
