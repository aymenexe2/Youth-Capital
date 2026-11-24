-- "Task for everyone": each concerned member gets their own copy of the task, linked by batch_id.
-- Existing data is not modified. Run once in the Supabase SQL editor (after 2026-11-dues-open-tasks.sql).
BEGIN;
ALTER TABLE "org_tasks" ADD COLUMN IF NOT EXISTS "batch_id" text;
CREATE INDEX IF NOT EXISTS "org_tasks_batch_idx" ON "org_tasks" USING btree ("org_id", "batch_id");
COMMIT;
