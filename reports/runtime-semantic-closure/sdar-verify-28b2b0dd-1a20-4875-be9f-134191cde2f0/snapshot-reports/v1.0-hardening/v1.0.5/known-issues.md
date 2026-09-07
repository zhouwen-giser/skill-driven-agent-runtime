# v1.0.5 Known Issues at Feature Tag

Paused LangGraph checkpoints remain process-local and are not reconstructed after process failure, matching the V1 rule that running Tasks are failed rather than recovered. PostgreSQL retains plan and confirmation audit evidence.

The bug-fixed audit must stress parent/child pause state, duplicate and stale confirmation, confirmation on a canceled parent Task, and child-plan mutation after confirmation.
