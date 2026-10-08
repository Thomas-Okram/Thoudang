-- Audit log is append-only: block UPDATE and DELETE at the database level (PostgreSQL equivalent of
-- the SQLite RAISE(ABORT) triggers in drizzle/sqlite/0001). TRUNCATE is blocked too.
CREATE OR REPLACE FUNCTION thoudang_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION thoudang_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION thoudang_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION thoudang_append_only();
