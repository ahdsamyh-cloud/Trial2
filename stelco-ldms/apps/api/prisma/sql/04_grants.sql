-- Least-privilege runtime role. The owner role runs migrations only.
GRANT USAGE ON SCHEMA public TO ldms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ldms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ldms_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM ldms_app;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM ldms_app;
REVOKE ALL ON "_prisma_migrations" FROM ldms_app;

-- Backup role (read-only, bypasses RLS so pg_dump can export restricted rows). Created by IT:
--   CREATE ROLE ldms_backup LOGIN BYPASSRLS PASSWORD '…';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ldms_backup') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO ldms_backup';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO ldms_backup';
    EXECUTE 'GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ldms_backup';
  END IF;
END $$;
