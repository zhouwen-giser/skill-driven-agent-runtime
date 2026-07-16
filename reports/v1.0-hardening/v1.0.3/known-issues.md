# v1.0.3 Known Issues at Feature Tag

The PostgreSQL answer/attempt transaction and Redis enqueue are intentionally separate durability boundaries. An enqueue exception is recorded as a failed attempt, but the bug-fixed audit must examine process-loss windows after the authoritative transaction and before enqueue, plus repeated delivery and bounded supplementary-input payloads.

Running attempts retain the V1 failure posture: process loss fails execution rather than reconstructing or automatically retrying it.
