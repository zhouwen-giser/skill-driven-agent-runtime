# Pinned time and trajectory evidence

Authority: SMPP `0a4a7c36865d4c9920a4e65857c0903e9ef12533`; copied public schemas are exact blobs.

| Field | Meaning supported by source | Consumer rule |
| --- | --- | --- |
| feedbackBody.providerRecordedAt | Provider business feedback clock; navigation-trajectory-processor uses fact.observedAt | Preserve value/path; reception basis requires qualified fact provenance, not the field name alone |
| Context.updatedAt / phase.since | Current Context/phase metadata | Never assign to each historical sample |
| summary.properties.trajectoryLast.observedAt | Last qualified position fact; runtime uses fieldObservationAuthority | Preserve as last fact time only; it is not the clock of every coordinate |
| Artifact.createdAt / updatedAt | Segment first/latest update | Preserve per-artifact; no per-coordinate interpolation |
| public streamId / sequence | Durable public stream order | Resume/order, independent of business freshness and Provider source cursor |
| deviceReportedAt | Not present in public trajectory schema | Explicit missing provenance; no inference |
| sdarReceivedAt / projectedAt | Local actual receipt/commit time | Separate from Provider sourceTime |

Pinned navigation-trajectory-processor caps geometry at 256 coordinates per segment and can
apply a sample interval. Stationary repeats only advance trajectoryLast. Artifacts contain
sampleCount and GeoJSON geometry, without sample IDs, per-sample timestamps or explicit gap
records. Read every precise segment revision, preserve raw content and report provider-retained
geometry completeness separately from full device-observation history/time completeness.
Unavailable per-sample reception time is an upstream gap, not permission to fill in now.
