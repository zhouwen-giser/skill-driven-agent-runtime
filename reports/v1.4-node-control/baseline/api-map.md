# P00 API and event map

| Contract | Version | Scope | Frozen inventory |
| --- | --- | --- | ---: |
| Node Control API | 1.0.0 | authenticated public/administrator API | 85 operations |
| Runtime Control | 1.0.0 | independently authenticated internal API | 26 operations |
| Node Events | 1.0.0 | change hints; consumers re-read resources | 20 messages |
| Telemetry Export | 1.0.0 | configuration/status/export only | no query operations |

The API freeze validates 28 JSON Schemas and 111 total operation IDs. Repository baseline Management
OpenAPI remains at SHA-256 `e23a88406d479d2d0d2daca845768c234298a4e63274437b6f17917b4a639cda`
with 164 validated operations; it is not silently replaced by the Node Control API.

All public writes require authentication, actor, reason, `Idempotency-Key`, and expected revision via
ETag/`If-Match` where applicable. Long-running commands return a durable ManagementOperation. Errors
use stable codes. Desired and observed state are explicit. Secret material is represented only by
references and status.
