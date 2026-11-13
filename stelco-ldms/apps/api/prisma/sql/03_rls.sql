-- Row-Level Security: defence in depth for restricted matters (ethical wall).
-- Request context is set per transaction by PrismaService:
--   app.ctx     = 'user' | 'system'
--   app.user_id = acting user id
--   app.is_hod  = 'on' if the actor is HoD
-- No context set → restricted rows are invisible (fail closed).
CREATE OR REPLACE FUNCTION ldms_can_see_matter(m_id text, m_restricted boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT m_restricted
      OR current_setting('app.ctx', true) = 'system'
      OR current_setting('app.is_hod', true) = 'on'
      OR EXISTS (SELECT 1 FROM "MatterAccess" a WHERE a."matterId" = m_id AND a."userId" = current_setting('app.user_id', true));
$$;
CREATE OR REPLACE FUNCTION ldms_can_see_matter_id(m_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m_id IS NULL OR EXISTS (SELECT 1 FROM "Matter" m WHERE m.id = m_id AND ldms_can_see_matter(m.id, m.restricted));
$$;

ALTER TABLE "Matter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Matter" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matter_wall ON "Matter";
CREATE POLICY matter_wall ON "Matter" USING (ldms_can_see_matter(id, restricted)) WITH CHECK (true);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['Document','Comment','LitigationCase','DraftingRequest','StatusTransition','MatterAssignment','SlaClock','Contract','LegalOpinion'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS wall ON %I', t);
    EXECUTE format('CREATE POLICY wall ON %I USING (ldms_can_see_matter_id("matterId")) WITH CHECK (true)', t);
  END LOOP;
END $$;

ALTER TABLE "CalendarEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wall ON "CalendarEvent";
CREATE POLICY wall ON "CalendarEvent" USING (NOT restricted OR ldms_can_see_matter_id("matterId")) WITH CHECK (true);
