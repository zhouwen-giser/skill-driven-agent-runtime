# EP-01 production stream and resubscribe increment

The official A2A client disconnects immediately after the initial Task event. Real BullMQ and TaskService processing continues in the single-process production composition; polling reaches `INPUT_REQUIRED`, and `resubscribeTask` returns the persisted Task snapshot. The client then closes the long-lived subscription explicitly.

The endpoint shutdown path now closes active connections after initiating graceful HTTP shutdown, preventing abandoned subscriptions from blocking local operations.

Result: production e2e 5 passed, 0 failed. This evidence closes FR-A2A-001, FR-A2A-004 and FR-A2A-005 together with the previously recorded operation/result and official protocol evidence.
