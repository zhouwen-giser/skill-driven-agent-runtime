# embodied.area_patrol

## Goal

Patrol a bounded area with an authorized resource and produce coverage, trajectory, and anomaly evidence.

## Non-goals

- Do not redefine Provider resource state, reservations, or time-window guarantees.
- Do not patrol outside the authorized boundary or silently skip required subregions.
- Do not report full success when a degraded edge, missing coverage, or missing trajectory remains.

## Composition and failure

Partition the authorized boundary into bounded subregions. Use exact `embodied.move_to` as the fixed
movement dependency and resolve the declared inspection capability slot from admitted candidates. A
recoverable subregion may be retried within budget; a degraded edge must remain visible with missing
coverage/effects and can never be projected as full success.

## Success evidence

Coverage and trajectory are hard gates. Anomaly reporting is retained when observed, including an
explicit empty report when no anomaly was detected. Cancellation stops new subregions and preserves the
last authoritative resource state and partial evidence.
