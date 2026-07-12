CREATE TABLE IF NOT EXISTS goal_transition (
  transition_id text PRIMARY KEY,
  context_id text NOT NULL REFERENCES conversation_context(context_id),
  from_goal_id text NOT NULL REFERENCES goal(goal_id),
  to_goal_id text NOT NULL UNIQUE REFERENCES goal(goal_id),
  relationship text NOT NULL CHECK(relationship IN ('related_successor','unrelated_new')),
  decision_summary text NOT NULL,
  request_text text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS goal_transition_context_idx
  ON goal_transition(context_id,created_at,transition_id);
