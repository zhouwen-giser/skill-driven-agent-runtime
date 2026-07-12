CREATE TABLE IF NOT EXISTS task_wait_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  timeout_seconds integer NOT NULL CHECK(timeout_seconds > 0),
  updated_at timestamptz NOT NULL
);

INSERT INTO task_wait_policy(singleton,timeout_seconds,updated_at)
VALUES(true,300,now()) ON CONFLICT(singleton) DO NOTHING;
