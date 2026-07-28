# P06 Standard Handoff V1.1

Handoff must conform exactly to `templates/STANDARD-HANDOFF.json` and shared `HandoffEnvelope`.

Top-level package-specific fields are forbidden. Package-specific deliverables are listed in `packageOutputs` under their frozen contract names.

Registry: V1.2 / `8aa828faf544b2cad3d3eb72bfc0935b02ba324a517de1563308862fc7d60dee`.

P06 may start only after the P05 Handoff is `COMPLETED`. It consumes the immutable P05
`ArtifactValidationResult V1.1` and `ArtifactCounterexample V1.1`; Shadow/Promotion workers must not
recompute, overwrite, or reinterpret P05 metrics and result hashes. This alignment does not start
P06 implementation.

Downstream package: `P07`.
