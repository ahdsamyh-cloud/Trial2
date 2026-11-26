-- A document belongs to at most one owner (library documents have none).
ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS document_single_owner;
ALTER TABLE "Document" ADD CONSTRAINT document_single_owner CHECK (
  num_nonnulls("matterId", "intakeId", "hearingId", "lawId", "checkItemId", "findingId", "sessionId", "contractId", "poaId") <= 1
);
-- Legal hold blocks deletion and soft-deletion at the database level too.
CREATE OR REPLACE FUNCTION legal_hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."legalHold" THEN RAISE EXCEPTION 'record is under legal hold'; END IF;
  IF TG_OP = 'UPDATE' AND OLD."legalHold" AND NEW."legalHold" AND NEW."deletedAt" IS NOT NULL AND OLD."deletedAt" IS NULL THEN
    RAISE EXCEPTION 'record is under legal hold';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS document_legal_hold ON "Document";
CREATE TRIGGER document_legal_hold BEFORE UPDATE OR DELETE ON "Document" FOR EACH ROW EXECUTE FUNCTION legal_hold_guard();
CREATE OR REPLACE FUNCTION matter_legal_hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."legalHold" THEN RAISE EXCEPTION 'matter is under legal hold'; END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS matter_legal_hold ON "Matter";
CREATE TRIGGER matter_legal_hold BEFORE DELETE ON "Matter" FOR EACH ROW EXECUTE FUNCTION matter_legal_hold_guard();
-- Full-text search indexes.
CREATE INDEX IF NOT EXISTS matter_fts ON "Matter" USING GIN (to_tsvector('english', coalesce("reference",'') || ' ' || coalesce("title",'') || ' ' || coalesce("description",'') || ' ' || coalesce("searchText",'')));
CREATE INDEX IF NOT EXISTS docver_fts ON "DocumentVersion" USING GIN (to_tsvector('english', coalesce("filename",'') || ' ' || coalesce("extractedText",'')));
CREATE INDEX IF NOT EXISTS email_fts ON "EmailMessage" USING GIN (to_tsvector('english', coalesce("subject",'') || ' ' || coalesce("bodyText",'')));
CREATE INDEX IF NOT EXISTS law_fts ON "Law" USING GIN (to_tsvector('english', coalesce("title",'') || ' ' || coalesce("summary",'')));
CREATE INDEX IF NOT EXISTS contract_fts ON "Contract" USING GIN (to_tsvector('english', coalesce("title",'') || ' ' || coalesce("keyObligations",'')));
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS matter_ref_trgm ON "Matter" USING GIN ("reference" gin_trgm_ops);
