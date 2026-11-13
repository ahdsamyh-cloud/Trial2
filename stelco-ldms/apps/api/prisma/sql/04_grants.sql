-- Least-privilege runtime role. The owner role runs migrations only.
GRANT USAGE ON SCHEMA public TO ldms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ldms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ldms_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM ldms_app;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM ldms_app;
REVOKE ALL ON "_prisma_migrations" FROM ldms_app;
