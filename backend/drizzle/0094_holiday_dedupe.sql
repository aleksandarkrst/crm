-- CD-318: every holiday now repeats yearly, so the rows "Copy from last year" made for later years
-- (same day and month, name, hours and span as an earlier row of the workspace) would show twice.
-- Keep the earliest row of each such series; it covers every later year.
DELETE FROM "public_holidays" p
USING "public_holidays" q
WHERE q."tenant_id" = p."tenant_id"
  AND q."id" <> p."id"
  AND to_char(q."holiday_date", 'MM-DD') = to_char(p."holiday_date", 'MM-DD')
  AND q."name" = p."name"
  AND q."minutes" IS NOT DISTINCT FROM p."minutes"
  AND q."end_date" IS NOT DISTINCT FROM p."end_date"
  AND q."holiday_date" < p."holiday_date";
