# M1 compiler gate experiment (not product acceptance)

2026-09-07, installed pinned LangGraph 1.4.7, Node 22.23.1; in-memory graph only, no tool calls.

Graph: fork -> conditional left path (true/false) -> common left arrival gate; fork -> right -> right arrival gate; AND(left arrival, right arrival) -> join -> bounded three-round fork reentry.

Observed: `round=3`, events `right,left_true,join,right,left_false,join,right,left_true,join`.
The engine resets an AND barrier after each join and permits alternate conditional predecessors to satisfy a branch's single gate. This supports the proposed compilation approach. It does not yet test fork invocation identity, remote waits, checkpoint restoration, nested-loop activations, conflict provenance, or product validation. No M1 implementation or acceptance claim is made.
