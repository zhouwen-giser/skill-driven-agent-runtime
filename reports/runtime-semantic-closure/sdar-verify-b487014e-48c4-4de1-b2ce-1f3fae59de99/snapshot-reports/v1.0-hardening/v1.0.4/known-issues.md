# v1.0.4 Known Issues at Feature Tag

SDAR marks simulation and historical replay requests but does not assume it can prevent device operations. The target MCP Server must recognize the reserved Headers and implement compatible behavior; operator review remains required for side-effecting Tools.

The bug-fixed audit must stress case-insensitive/duplicate Header normalization, failure audit, paused/resumed context retention and session cleanup under repeated simulation identities.
