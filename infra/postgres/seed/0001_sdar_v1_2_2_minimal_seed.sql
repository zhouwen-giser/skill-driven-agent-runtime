-- Idempotent, non-secret minimum state required by development/test startup.
INSERT INTO public.evolution_policy(singleton, success_threshold, updated_at)
VALUES (true, 2, clock_timestamp())
ON CONFLICT (singleton) DO NOTHING;

INSERT INTO public.memory_retention_policy(
  singleton,
  review_after_days,
  archive_after_days,
  delete_after_days,
  automatic_archive_enabled,
  automatic_delete_enabled,
  updated_at
)
VALUES (true, 90, 365, 730, false, false, clock_timestamp())
ON CONFLICT (singleton) DO NOTHING;

INSERT INTO public.task_wait_policy(singleton, timeout_seconds, updated_at)
VALUES (true, 300, clock_timestamp())
ON CONFLICT (singleton) DO NOTHING;
