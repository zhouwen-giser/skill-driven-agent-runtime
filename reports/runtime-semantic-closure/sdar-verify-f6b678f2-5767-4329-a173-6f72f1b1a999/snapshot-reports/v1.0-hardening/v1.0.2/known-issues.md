# v1.0.2 Known Issues

Nested confirmation policy will be finalized in v1.0.5.

The feature tag intentionally retains the existing one-row-per-parent-node linkage key. If a loop re-enters the same `skill_call` node, the latest relation replaces the earlier relation even though the child Workflow instances remain immutable. The v1.0.2 bug-fixed phase reviews and repairs this audit-history limitation.
