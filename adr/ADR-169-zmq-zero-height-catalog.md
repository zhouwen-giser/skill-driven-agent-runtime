# ADR-169: Explicit regional zero default in native ZMQ 1.3.0

Status: Accepted, 2026-10-29. The new catalog supersedes mandatory operator-entered regional
height; previous reviewed catalogs and history remain exact.

The operator explicitly selected omission => WGS84 ellipsoid height 0 meters and confirmed
60 km/h (60 / 3.6 m/s), obstacle avoidance, entry point 106.813064505,29.720529508.
Zero is an operator default, never measured terrain. Native AreaSearch still receives numeric
heights. Null/nonfinite regional heights reject; unknown simulation-target height stays nullable.

Publish zmq_v1_3_0_site_control_13 with the same 13 names. Resolve heights before confirmation,
freeze effective arguments and carry ellipsoidHeightSource=provided|default_zero to child/native
requests. Only zero may carry default_zero. Provider strips this field from native wire parameters,
persisting requested/effective inputs and per-vertex sources in existing execution JSONB/reports.
Parent patrol reports original/effective regions. Exact source/profile/schema/Task Profile/CAS
checks apply to the successor. Native rejection of zero or speed remains a field blocker.

The accepted maintenance plan separately authorizes removal of old owner trajectory archives,
preserving current owner Tasks, live ZMQ archive and state snapshots. No frozen migration or
persistent guard weakening is required. Formal promotion requires actual operator-confirmed
A2A action evidence, exclusive consumers/writer leases and real PMS lineage.

Validation: v13 unit/contract/PG/ZMQ/browser and joint scenarios plus the full evidence gate.
ExecPlan: execplans/ugv-zmq-zero-height-field-20261029.md. Current status: IN_PROGRESS.
