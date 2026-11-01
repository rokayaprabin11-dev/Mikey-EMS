-- Indexes only (DECISIONS.md D24): no row is changed.

-- Hand-written, like the index it replaces: a guardian's phone numbers as digits only, and each
-- again reversed with an "r" in front, so a search finds a number by its first digits or by its
-- last ones ("2884" finds 98600 12884 through the word r4882100689). The student search
-- (apps/server/src/students/lookup.ts) uses this exact expression.
DROP INDEX "guardians_phone_search_idx";

CREATE INDEX "guardians_phone_search_idx" ON "guardians"
  USING gin (to_tsvector('simple'::regconfig,
    regexp_replace("phone", '[^0-9]', '', 'g') || ' ' || regexp_replace(coalesce("alt_phone", ''), '[^0-9]', '', 'g')
    || ' r' || reverse(regexp_replace("phone", '[^0-9]', '', 'g'))
    || ' r' || reverse(regexp_replace(coalesce("alt_phone", ''), '[^0-9]', '', 'g'))));
