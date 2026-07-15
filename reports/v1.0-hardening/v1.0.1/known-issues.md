# v1.0.1 Known Issues

No known P0/P1 correctness defect at the feature gate.

Intentional limits:

- Bound values are finite JSON only.
- Reference paths use explicit identifier or array-index segments; JSONPath, string interpolation and executable expressions are unsupported.
- Missing references fail the executing node instead of producing `undefined` or silently applying a default.
