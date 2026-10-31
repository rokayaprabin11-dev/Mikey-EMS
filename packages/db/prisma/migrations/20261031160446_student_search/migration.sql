-- Additive only (DECISIONS.md D24): new indexes.

-- Hand-written: Prisma cannot express expression indexes. The student search (apps/server/src/
-- students/search.ts) uses these exact expressions, so the planner can use the indexes.
-- Names and student IDs, split into words with punctuation removed ("MEMS-2076-0098" gives the
-- words mems, 2076 and 0098), so a search matches the start of any word.
CREATE INDEX "students_search_idx" ON "students"
  USING gin (to_tsvector('simple'::regconfig, regexp_replace("full_name" || ' ' || "student_code", '[^[:alnum:]]+', ' ', 'g')));

-- A guardian's phone numbers as digits only, so "98600 12884" is found by 9860012884 or 98600.
CREATE INDEX "guardians_phone_search_idx" ON "guardians"
  USING gin (to_tsvector('simple'::regconfig, regexp_replace("phone", '[^0-9]', '', 'g') || ' ' || regexp_replace(coalesce("alt_phone", ''), '[^0-9]', '', 'g')));
