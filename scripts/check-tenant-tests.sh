#!/bin/sh
# Tenant isolation test for new tables (CD-311): when a pull request adds a CREATE TABLE with a
# tenant_id column, an integration spec added or changed in the same pull request must name that
# table (backend/test/integration/**, usually tenant-isolation.spec.ts; see
# /new-tenant-table step 5). Keeps "new tenant table = new isolation test" without a reviewer.
#
#   scripts/check-tenant-tests.sh [base-ref]        (base-ref: origin/main)
#   GUARD_FILES=$'backend/drizzle/0099_x.sql\nbackend/test/integration/x.spec.ts' scripts/check-tenant-tests.sh
#
# POSIX sh + awk. Exit 1 names each table without a test.
set -eu

root="${GUARD_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
. "$(cd "$(dirname "$0")" && pwd)/lib-changed-files.sh"
base="${1:-origin/main}"
cd "$root"

migrations=$(changed_files "$base" backend/drizzle/ | grep '\.sql$' || true)
if [ -z "$migrations" ]; then
  echo "check-tenant-tests: no migration files added or changed against $base"
  exit 0
fi

# Tenant tables created in those files, minus the ones they drop again.
tables=$(awk '
  function name(s, prefix) { sub(prefix, "", s); sub(/^"public"\./, "", s); sub(/^"/, "", s); sub(/".*$/, "", s); return s }
  /^[ \t]*--/ { next }
  /CREATE TABLE +(IF NOT EXISTS +)?("public"\.)?"/ { cur = name($0, "^.*CREATE TABLE +(IF NOT EXISTS +)?"); intable = 1; next }
  intable && /^[ \t]*"tenant_id"[ \t]/ { scoped[cur] = 1 }
  intable && /^\);/ { intable = 0 }
  /DROP TABLE +(IF EXISTS +)?("public"\.)?"/ { dropped[name($0, "^.*DROP TABLE +(IF EXISTS +)?")] = 1 }
  END { for (t in scoped) if (!(t in dropped)) print t }
' $migrations | sort)
if [ -z "$tables" ]; then
  echo "check-tenant-tests: no new tenant-scoped table in $(printf '%s\n' "$migrations" | wc -l | tr -d ' ') migration file(s)"
  exit 0
fi

specs=$(changed_files "$base" backend/test/integration/ || true)
missing=""
for t in $tables; do
  covered=0
  for s in $specs; do
    [ -f "$s" ] || continue
    if grep -q "$t" "$s"; then covered=1; break; fi
  done
  [ "$covered" = 1 ] || missing="${missing}${t}
"
done

if [ -n "$missing" ]; then
  echo "check-tenant-tests: new tenant-scoped tables without an integration test in this pull request:"
  printf '%s' "$missing" | sed 's/^/  - /'
  echo "Add or change a spec under backend/test/integration/ that names the table (tenant-isolation.spec.ts:"
  echo "no rows without a tenant, 42501 on a write into another tenant, 23503 on a cross-tenant reference)."
  exit 1
fi

echo "check-tenant-tests: every new tenant-scoped table ($(printf '%s\n' "$tables" | tr '\n' ' ' | sed 's/ $//')) is named in a changed integration spec"
